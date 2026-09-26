import fs from 'fs';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import { createServer as createViteServer } from 'vite';

const app = express();
const PORT = parseInt(process.env.PORT || '3000', 10);
const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'scrutin.json');

app.use(express.json());

// List of the 11 authorized electors
const INITIAL_ELECTORS = [
  'OTINEL',
  'ESTHER',
  'LEGER',
  'ROXANE',
  'GILBERT',
  'EMILE',
  'DESIRE',
  'CYPRIEN',
  'ULRICH',
  'WILFRIED',
  'JOSIANE'
];

interface ElectorRecord {
  id: string;
  name: string; // canonical uppercase
  hasVoted: boolean;
  votedAt?: string;
}

interface VoteRecord {
  id: string;
  choice: 'OUI' | 'NON' | 'NEUTRE';
  justification?: string;
  timestamp: string;
}

interface ScrutinData {
  electors: ElectorRecord[];
  votes: VoteRecord[];
  isClosed: boolean;
  areResultsPublished: boolean;
  lastUpdated: string;
}

// Ensure data file exists with default state
function initData(): ScrutinData {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  if (fs.existsSync(DATA_FILE)) {
    try {
      const content = fs.readFileSync(DATA_FILE, 'utf-8');
      const parsed = JSON.parse(content) as ScrutinData;
      // Ensure all 11 electors exist
      const existingNames = new Set(parsed.electors.map(e => e.name.toUpperCase()));
      for (const name of INITIAL_ELECTORS) {
        if (!existingNames.has(name)) {
          parsed.electors.push({
            id: name.toLowerCase(),
            name,
            hasVoted: false
          });
        }
      }
      return parsed;
    } catch (err) {
      console.error('Error reading scrutin.json, resetting to initial state', err);
    }
  }

  const defaultData: ScrutinData = {
    electors: INITIAL_ELECTORS.map(name => ({
      id: name.toLowerCase(),
      name,
      hasVoted: false
    })),
    votes: [],
    isClosed: false,
    areResultsPublished: false,
    lastUpdated: new Date().toISOString()
  };

  fs.writeFileSync(DATA_FILE, JSON.stringify(defaultData, null, 2), 'utf-8');
  return defaultData;
}

let store: ScrutinData = initData();

function saveStore() {
  try {
    store.lastUpdated = new Date().toISOString();
    const serialized = JSON.stringify(store, null, 2);
    const tempFile = `${DATA_FILE}.tmp`;
    fs.writeFileSync(tempFile, serialized, 'utf-8');
    fs.renameSync(tempFile, DATA_FILE);
    // Also maintain a backup copy
    fs.writeFileSync(path.join(DATA_DIR, 'scrutin.backup.json'), serialized, 'utf-8');
  } catch (err) {
    console.error('Error saving store:', err);
  }
}

// Normalize strings for resilient matching (ignore accents, case, extra spaces)
function normalizeName(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();
}

// Authentication middleware for AHDOC admin
const ADMIN_ACCESS_CODE = '84';
function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers['x-admin-code'] || req.headers['authorization'];
  if (authHeader === ADMIN_ACCESS_CODE || authHeader === `Bearer ${ADMIN_ACCESS_CODE}`) {
    next();
  } else {
    res.status(401).json({ error: 'UNAUTHORIZED', message: 'Code d\'accès administrateur invalide.' });
  }
}

// --- API ROUTES ---

// 1. Get Public Scrutin Status
app.get('/api/status', (_req: Request, res: Response) => {
  const totalElectors = store.electors.length;
  const votesCount = store.votes.length;

  const publicData: any = {
    isClosed: store.isClosed,
    areResultsPublished: store.areResultsPublished,
    totalElectors,
    recordedVotesCount: votesCount,
    scrutinDate: 'Samedi 26 septembre 2026',
    candidateName: 'WOYA SYLAS'
  };

  if (store.areResultsPublished) {
    const oui = store.votes.filter(v => v.choice === 'OUI').length;
    const non = store.votes.filter(v => v.choice === 'NON').length;
    const neutre = store.votes.filter(v => v.choice === 'NEUTRE').length;
    publicData.results = {
      oui,
      non,
      neutre,
      total: store.votes.length,
      participationRate: totalElectors > 0 ? Math.round((votesCount / totalElectors) * 1000) / 10 : 0
    };
  }

  res.json(publicData);
});

// 2. Check Elector Authorization
app.post('/api/check-elector', (req: Request, res: Response) => {
  const { firstName } = req.body;

  if (!firstName || typeof firstName !== 'string' || !firstName.trim()) {
    res.status(400).json({ error: 'INVALID_INPUT', message: 'Veuillez saisir votre prénom.' });
    return;
  }

  const normalized = normalizeName(firstName);

  // Sylas is explicitly forbidden from voting
  if (normalized.includes('SYLAS') || normalized.includes('WOYA')) {
    res.status(403).json({
      error: 'SYLAS_EXCLUDED',
      message: "Sylas est le candidat et ne peut pas voter."
    });
    return;
  }

  // Find elector
  const elector = store.electors.find(e => normalizeName(e.name) === normalized);

  if (!elector) {
    res.status(403).json({
      error: 'NOT_AUTHORIZED',
      message: "Vous n'êtes pas habilité(e) à participer à ce scrutin."
    });
    return;
  }

  if (elector.hasVoted) {
    if (store.votes.length === 0) {
      elector.hasVoted = false;
    } else {
      res.status(403).json({
        error: 'ALREADY_VOTED',
        message: "Vous avez déjà participé à ce scrutin. Un second vote n'est pas autorisé."
      });
      return;
    }
  }

  if (store.isClosed) {
    res.status(403).json({
      error: 'SCRUTIN_CLOSED',
      message: "Le scrutin est clôturé. Aucun vote n'est accepté."
    });
    return;
  }

  res.json({
    success: true,
    firstName: elector.name,
    message: "Identification validée. Vous pouvez procéder au vote."
  });
});

// 3. Record Vote
app.post('/api/vote', (req: Request, res: Response) => {
  const { firstName, choice, justification } = req.body;

  if (store.isClosed) {
    res.status(403).json({
      error: 'SCRUTIN_CLOSED',
      message: "Le scrutin est clôturé. Aucun nouveau vote ne peut être enregistré."
    });
    return;
  }

  if (store.votes.length >= store.electors.length) {
    res.status(403).json({
      error: 'MAX_VOTES_REACHED',
      message: "Tous les votes ont déjà été enregistrés."
    });
    return;
  }

  if (!firstName || typeof firstName !== 'string') {
    res.status(400).json({ error: 'INVALID_INPUT', message: 'Prénom requis.' });
    return;
  }

  const normalized = normalizeName(firstName);

  if (normalized.includes('SYLAS') || normalized.includes('WOYA')) {
    res.status(403).json({
      error: 'SYLAS_EXCLUDED',
      message: "Sylas est le candidat et ne peut pas voter."
    });
    return;
  }

  const electorIndex = store.electors.findIndex(e => normalizeName(e.name) === normalized);
  if (electorIndex === -1) {
    res.status(403).json({
      error: 'NOT_AUTHORIZED',
      message: "Vous n'êtes pas habilité(e) à participer à ce scrutin."
    });
    return;
  }

  const elector = store.electors[electorIndex];
  if (elector.hasVoted) {
    if (store.votes.length === 0) {
      elector.hasVoted = false;
    } else {
      res.status(403).json({
        error: 'ALREADY_VOTED',
        message: "Vous avez déjà participé à ce scrutin. Un second vote n'est pas autorisé."
      });
      return;
    }
  }

  if (!['OUI', 'NON', 'NEUTRE'].includes(choice)) {
    res.status(400).json({ error: 'INVALID_CHOICE', message: 'Choix de vote invalide.' });
    return;
  }

  // NON and NEUTRE require justification
  if ((choice === 'NON' || choice === 'NEUTRE')) {
    if (!justification || typeof justification !== 'string' || justification.trim().length < 3) {
      res.status(400).json({
        error: 'JUSTIFICATION_REQUIRED',
        message: choice === 'NON'
          ? 'Veuillez expliquer brièvement les raisons de votre choix.'
          : 'Veuillez expliquer brièvement les raisons de votre neutralité.'
      });
      return;
    }
  }

  // 1. Mark elector as voted (to prevent double vote)
  store.electors[electorIndex].hasVoted = true;
  store.electors[electorIndex].votedAt = new Date().toISOString();

  // 2. Record vote separately without elector identity (Confidentiality / Secret Ballot)
  const voteId = 'v_' + Math.random().toString(36).substring(2, 10);
  store.votes.push({
    id: voteId,
    choice,
    justification: choice !== 'OUI' && justification ? justification.trim() : undefined,
    timestamp: new Date().toISOString()
  });

  saveStore();

  res.json({
    success: true,
    message: "Votre participation au scrutin ROUAMA a bien été enregistrée."
  });
});

// 4. Admin Login Check
app.post('/api/admin/auth', (req: Request, res: Response) => {
  const { code } = req.body;
  if (code === ADMIN_ACCESS_CODE) {
    res.json({ success: true, token: ADMIN_ACCESS_CODE });
  } else {
    res.status(401).json({ error: 'INVALID_CODE', message: "Code d'accès incorrect." });
  }
});

// 5. Admin Dashboard Data
app.get('/api/admin/dashboard', requireAdmin, (_req: Request, res: Response) => {
  const totalElectors = store.electors.length;
  const recordedVotesCount = store.votes.length;
  const notVotedCount = Math.max(0, totalElectors - recordedVotesCount);
  const participationRate = totalElectors > 0
    ? Math.round((recordedVotesCount / totalElectors) * 1000) / 10
    : 0;

  const oui = store.votes.filter(v => v.choice === 'OUI').length;
  const non = store.votes.filter(v => v.choice === 'NON').length;
  const neutre = store.votes.filter(v => v.choice === 'NEUTRE').length;

  const justifications = store.votes
    .filter(v => v.choice === 'NON' || v.choice === 'NEUTRE')
    .map(v => ({
      id: v.id,
      choice: v.choice,
      justification: v.justification || '',
      timestamp: v.timestamp
    }));

  res.json({
    totalElectors,
    recordedVotesCount,
    notVotedCount,
    participationRate,
    isClosed: store.isClosed,
    areResultsPublished: store.areResultsPublished,
    results: {
      oui,
      non,
      neutre,
      total: recordedVotesCount
    },
    justifications,
    electors: store.electors.map(e => ({
      name: e.name,
      hasVoted: e.hasVoted,
      votedAt: e.votedAt
    }))
  });
});

// 6. Admin Action: Close Scrutin
app.post('/api/admin/close', requireAdmin, (_req: Request, res: Response) => {
  store.isClosed = true;
  saveStore();
  res.json({ success: true, message: 'Le scrutin a été clôturé avec succès.' });
});

// 7. Admin Action: Reopen Scrutin
app.post('/api/admin/reopen', requireAdmin, (_req: Request, res: Response) => {
  store.isClosed = false;
  saveStore();
  res.json({ success: true, message: 'Le scrutin a été rouvert.' });
});

// 8. Admin Action: Publish Results
app.post('/api/admin/publish', requireAdmin, (_req: Request, res: Response) => {
  if (!store.isClosed) {
    res.status(400).json({
      error: 'SCRUTIN_NOT_CLOSED',
      message: 'Le scrutin doit impérativement être clôturé avant de pouvoir publier les résultats.'
    });
    return;
  }
  store.areResultsPublished = true;
  saveStore();
  res.json({ success: true, message: 'Les résultats sont désormais publics.' });
});

// 9. Admin Action: Unpublish Results
app.post('/api/admin/unpublish', requireAdmin, (_req: Request, res: Response) => {
  store.areResultsPublished = false;
  saveStore();
  res.json({ success: true, message: 'Les résultats ont été rendus confidentiels.' });
});

// 10. Admin Action: Reset (Useful during testing/re-initializing)
app.post('/api/admin/reset', requireAdmin, (_req: Request, res: Response) => {
  store = {
    electors: INITIAL_ELECTORS.map(name => ({
      id: name.toLowerCase(),
      name,
      hasVoted: false
    })),
    votes: [],
    isClosed: false,
    areResultsPublished: false,
    lastUpdated: new Date().toISOString()
  };
  saveStore();
  res.json({ success: true, message: 'La base du scrutin a été réinitialisée.' });
});

// --- VITE MIDDLEWARE / STATIC FILES ---
async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer();
