import React, { useState, useEffect } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch, doc, getDoc, setDoc, addDoc } from 'firebase/firestore';
import {
  Vote as VoteIcon,
  ShieldCheck,
  Lock,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
  ArrowLeft,
  ChevronRight,
  Eye,
  EyeOff,
  UserCheck,
  RotateCcw,
  BarChart3,
  Award,
  Calendar,
  Users,
  Check,
  X,
  MinusCircle,
  Scale,
  Info
} from 'lucide-react';

type Page =
  | 'accueil'
  | 'identification'
  | 'vote'
  | 'confirmation'
  | 'enregistre'
  | 'resultats_publics'
  | 'admin_login'
  | 'admin_dashboard';

type VoteChoice = 'OUI' | 'NON' | 'NEUTRE';

interface ScrutinStatus {
  isClosed: boolean;
  areResultsPublished: boolean;
  totalElectors: number;
  recordedVotesCount: number;
  scrutinDate: string;
  candidateName: string;
  results?: {
    oui: number;
    non: number;
    neutre: number;
    total: number;
    participationRate: number;
  };
}

interface AdminDashboardData {
  totalElectors: number;
  recordedVotesCount: number;
  notVotedCount: number;
  participationRate: number;
  isClosed: boolean;
  areResultsPublished: boolean;
  results: {
    oui: number;
    non: number;
    neutre: number;
    total: number;
  };
  justifications: Array<{
    id: string;
    choice: 'NON' | 'NEUTRE';
    justification: string;
    timestamp: string;
  }>;
  electors: Array<{
    name: string;
    hasVoted: boolean;
    votedAt?: string;
  }>;
}

// Firebase Configuration
const firebaseConfig = {
  apiKey: "AIzaSyBhTmSZTXBIzFJ0z27NG5B_zN8JtT2necg",
  authDomain: "rouama-vote.firebaseapp.com",
  projectId: "rouama-vote",
  storageBucket: "rouama-vote.firebasestorage.app",
  messagingSenderId: "649240559564",
  appId: "1:649240559564:web:9ec6fd5293ec6882e5a769",
  measurementId: "G-1ERFVKDBR6"
};

const fbApp = getApps().length ? getApp() : initializeApp(firebaseConfig);
const db = getFirestore(fbApp);

// Helper to ensure clean storage without voter tracking or blocking
function clearLocalVoterData() {
  try {
    ['rouama_voted_electors_set', 'rouama_last_voted_elector', 'rouama_voted_names', 'rouama_last_voter'].forEach(k => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
  } catch (e) {
    console.warn('Storage clean error', e);
  }
}

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>('accueil');

  const [status, setStatus] = useState<ScrutinStatus | null>(null);
  const [, setIsLoadingStatus] = useState(true);

  // Elector identification state
  const [firstNameInput, setFirstNameInput] = useState('');
  const [electorName, setElectorName] = useState<string | null>(null);
  const [idError, setIdError] = useState<string | null>(null);
  const [isVerifyingId, setIsVerifyingId] = useState(false);

  // Voting state
  const [selectedChoice, setSelectedChoice] = useState<VoteChoice | null>(null);
  const [justification, setJustification] = useState('');
  const [voteError, setVoteError] = useState<string | null>(null);
  const [isSubmittingVote, setIsSubmittingVote] = useState(false);

  // Admin state
  const [adminCodeInput, setAdminCodeInput] = useState('');
  const [adminToken, setAdminToken] = useState<string | null>(() => sessionStorage.getItem('rouama_admin_token'));
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminData, setAdminData] = useState<AdminDashboardData | null>(null);
  const [isLoadingAdmin, setIsLoadingAdmin] = useState(false);
  const [adminActionMessage, setAdminActionMessage] = useState<string | null>(null);
  const [showCloseConfirmModal, setShowCloseConfirmModal] = useState(false);
  const [showResetConfirmModal, setShowResetConfirmModal] = useState(false);

  // Fetch status from server
  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/status');
      if (res.ok) {
        const data = await res.json();
        setStatus(data);
      }
    } catch (e) {
      console.error('Failed to load status', e);
    } finally {
      setIsLoadingStatus(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 15000);
    return () => clearInterval(interval);
  }, []);

  // Fetch admin dashboard
  const fetchAdminData = async (token = adminToken) => {
    if (!token) return;
    setIsLoadingAdmin(true);
    try {
      const res = await fetch('/api/admin/dashboard', {
        headers: { 'x-admin-code': token }
      });
      if (res.ok) {
        const data = await res.json();
        setAdminData(data);
      } else {
        setAdminToken(null);
        sessionStorage.removeItem('rouama_admin_token');
        setCurrentPage('admin_login');
      }
    } catch (e) {
      console.error('Failed to fetch admin data', e);
    } finally {
      setIsLoadingAdmin(false);
    }
  };

  useEffect(() => {
    clearLocalVoterData();
  }, []);

  useEffect(() => {
    if (currentPage === 'admin_dashboard' && adminToken) {
      fetchAdminData();
    }
  }, [currentPage, adminToken]);

  // Handle Identification
  const handleVerifyElector = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = firstNameInput.trim();
    if (!trimmed) {
      setIdError('Veuillez saisir votre prénom.');
      return;
    }

    setIsVerifyingId(true);
    setIdError(null);

    const normalized = trimmed
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toUpperCase();

    // Vérification exclusion candidat Sylas
    if (normalized.includes('SYLAS') || normalized.includes('WOYA')) {
      setIdError("Sylas est le candidat et ne peut pas voter.");
      setIsVerifyingId(false);
      return;
    }

    const AUTHORIZED = [
      'OTINEL', 'ESTHER', 'LEGER', 'ROXANE', 'GILBERT',
      'EMILE', 'DESIRE', 'CYPRIEN', 'ULRICH', 'WILFRIED', 'JOSIANE'
    ];
    if (!AUTHORIZED.includes(normalized)) {
      setIdError(`Le prénom "${trimmed}" ne figure pas sur la liste officielle des 11 électeurs habilités.`);
      setIsVerifyingId(false);
      return;
    }

    try {
      // 1. Lire activeScrutinId depuis Firebase settings/currentScrutin
      let activeScrutinId = 1;
      try {
        const settingsSnap = await getDoc(doc(db, "settings", "currentScrutin"));
        if (settingsSnap.exists() && typeof settingsSnap.data()?.activeScrutinId === 'number') {
          activeScrutinId = settingsSnap.data().activeScrutinId;
        }
      } catch (err) {
        console.warn("Notice reading activeScrutinId:", err);
      }

      // 2. VÉRIFICATION STRICTE VIA FIREBASE UNIQUE :
      // Interroge UNIQUEMENT le document de l'électeur dans Firestore collection 'voters'
      const voterDocSnap = await getDoc(doc(db, "voters", normalized));

      if (voterDocSnap.exists()) {
        const voterData = voterDocSnap.data();
        // Vérifie uniquement si l'utilisateur a voté pour ce activeScrutinId précis
        const hasVotedThisScrutin = Boolean(
          voterData?.votesByScrutin && voterData.votesByScrutin[String(activeScrutinId)] === true
        );

        if (hasVotedThisScrutin) {
          setIdError("Vous avez déjà participé à ce scrutin. Un second vote n'est pas autorisé.");
          return;
        }
      }

      // Si votesByScrutin[activeScrutinId] est faux ou inexistant, ACCORDE L'ACCÈS AU BULLETIN immédiatement.
      // Supprime TOUTE dépendance à localStorage ou sessionStorage.
      setElectorName(normalized);
      setCurrentPage('vote');
    } catch (err: any) {
      console.error("Firestore identification error:", err);
      setIdError("Erreur lors de la vérification de l'électeur dans la base de données.");
    } finally {
      setIsVerifyingId(false);
    }
  };

  // Proceed from Vote Selection to Confirmation
  const handleProceedToConfirmation = () => {
    setVoteError(null);
    if (!selectedChoice) {
      setVoteError('Veuillez sélectionner votre choix de vote.');
      return;
    }
    if ((selectedChoice === 'NON' || selectedChoice === 'NEUTRE') && justification.trim().length < 3) {
      setVoteError(
        selectedChoice === 'NON'
          ? 'Veuillez expliquer brièvement les raisons de votre choix.'
          : 'Veuillez expliquer brièvement les raisons de votre neutralité.'
      );
      return;
    }
    setCurrentPage('confirmation');
  };

  // Submit Final Vote
  const handleFinalVoteSubmit = async () => {
    if (!electorName || !selectedChoice) return;
    setIsSubmittingVote(true);
    setVoteError(null);

    try {
      const now = new Date().toISOString();

      // Lire activeScrutinId
      let activeScrutinId = 1;
      try {
        const settingsSnap = await getDoc(doc(db, "settings", "currentScrutin"));
        if (settingsSnap.exists() && typeof settingsSnap.data()?.activeScrutinId === 'number') {
          activeScrutinId = settingsSnap.data().activeScrutinId;
        }
      } catch (_) {}

      // Enregistrement direct et prioritaire dans Firestore avec scrutinId
      await addDoc(collection(db, "votes"), {
        scrutinId: activeScrutinId,
        choice: selectedChoice,
        justification: selectedChoice !== 'OUI' ? justification.trim() : null,
        timestamp: now
      });

      if (selectedChoice !== 'OUI' && justification.trim()) {
        await addDoc(collection(db, "justifications"), {
          scrutinId: activeScrutinId,
          choice: selectedChoice,
          justification: justification.trim(),
          timestamp: now
        });
      }

      // Marquer comme ayant voté pour ce scrutinId précis dans Firestore
      await setDoc(doc(db, "voters", electorName), {
        name: electorName,
        hasVoted: true,
        votedAt: now,
        [`votesByScrutin.${activeScrutinId}`]: true,
        votesByScrutin: {
          [String(activeScrutinId)]: true
        }
      }, { merge: true });

      // Synchronisation secondaire backend (facultative)
      try {
        await fetch('/api/vote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            firstName: electorName,
            choice: selectedChoice,
            justification: selectedChoice !== 'OUI' ? justification.trim() : undefined
          })
        });
      } catch (_) {}

      // Clear temporary state (no local storage persistence)
      clearLocalVoterData();
      setFirstNameInput('');
      setSelectedChoice(null);
      setJustification('');
      await fetchStatus();
      setCurrentPage('enregistre');
    } catch {
      setVoteError("Erreur lors de la transmission du vote. Veuillez vérifier votre connexion.");
    } finally {
      setIsSubmittingVote(false);
    }
  };

  // Admin Login
  const handleAdminLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setAdminError(null);
    try {
      const res = await fetch('/api/admin/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: adminCodeInput.trim() })
      });
      const data = await res.json();
      if (res.ok) {
        setAdminToken(data.token);
        sessionStorage.setItem('rouama_admin_token', data.token);
        setAdminCodeInput('');
        setCurrentPage('admin_dashboard');
        fetchAdminData(data.token);
      } else {
        setAdminError(data.message || 'Code erroné.');
      }
    } catch {
      setAdminError('Erreur de communication avec le serveur.');
    }
  };

  // Admin Actions
  const handleCloseScrutin = async () => {
    if (!adminToken) return;
    setShowCloseConfirmModal(false);
    try {
      const res = await fetch('/api/admin/close', {
        method: 'POST',
        headers: { 'x-admin-code': adminToken }
      });
      if (res.ok) {
        setAdminActionMessage('Le scrutin a été clôturé avec succès.');
        await fetchAdminData();
        await fetchStatus();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleReopenScrutin = async () => {
    if (!adminToken) return;
    try {
      const res = await fetch('/api/admin/reopen', {
        method: 'POST',
        headers: { 'x-admin-code': adminToken }
      });
      if (res.ok) {
        setAdminActionMessage('Le scrutin a été rouvert.');
        await fetchAdminData();
        await fetchStatus();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handlePublishResults = async () => {
    if (!adminToken) return;
    if (!adminData?.isClosed) return;
    try {
      const res = await fetch('/api/admin/publish', {
        method: 'POST',
        headers: { 'x-admin-code': adminToken }
      });
      if (res.ok) {
        setAdminActionMessage('Les résultats sont désormais publics.');
        await fetchAdminData();
        await fetchStatus();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleUnpublishResults = async () => {
    if (!adminToken) return;
    try {
      const res = await fetch('/api/admin/unpublish', {
        method: 'POST',
        headers: { 'x-admin-code': adminToken }
      });
      if (res.ok) {
        setAdminActionMessage('Les résultats ont été rendus confidentiels.');
        await fetchAdminData();
        await fetchStatus();
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleReset = async () => {
    try {
      // 1. Incrémente activeScrutinId (+1) dans settings/currentScrutin
      let nextScrutinId = 2;
      try {
        const settingsSnap = await getDoc(doc(db, "settings", "currentScrutin"));
        if (settingsSnap.exists() && typeof settingsSnap.data()?.activeScrutinId === 'number') {
          nextScrutinId = settingsSnap.data().activeScrutinId + 1;
        }
      } catch (_) {}

      await setDoc(doc(db, "settings", "currentScrutin"), {
        activeScrutinId: nextScrutinId,
        updatedAt: new Date().toISOString()
      }, { merge: true });

      // 2. Efface complètement les collections 'votes' et 'justifications' via un batch Firestore
      const votesSnapshot = await getDocs(collection(db, "votes"));
      const batch = writeBatch(db);
      votesSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });

      const justifSnapshot = await getDocs(collection(db, "justifications"));
      justifSnapshot.forEach((doc) => {
        batch.delete(doc.ref);
      });

      // Remettre tous les membres à hasVoted: false dans la collection 'voters'
      const votersSnapshot = await getDocs(collection(db, "voters"));
      votersSnapshot.forEach((voterDoc) => {
        batch.update(voterDoc.ref, {
          hasVoted: false,
          [`votesByScrutin.${nextScrutinId}`]: false
        });
      });

      // 3. Valider la suppression dans Firebase
      await batch.commit();

      // Reset backend server
      try {
        await fetch('/api/admin/reset', {
          method: 'POST',
          headers: { 'x-admin-code': adminToken || '84' }
        });
      } catch (_) {}

      // 4. Vide le localStorage du navigateur : localStorage.clear(); sessionStorage.clear();
      try { localStorage.clear(); } catch (_) {}
      try { sessionStorage.clear(); } catch (_) {}

      setAdminActionMessage('Nouveau scrutin réinitialisé avec succès !');
      await fetchAdminData();
      await fetchStatus();

      alert("Nouveau scrutin réinitialisé avec succès !");
    } catch (error) {
      console.error("Erreur lors de la réinitialisation :", error);
      alert("Erreur lors de la réinitialisation.");
    }
  };

  const handleResetScrutin = async () => {
    setShowResetConfirmModal(false);
    await handleReset();
  };

  const handleAdminLogout = () => {
    setAdminToken(null);
    sessionStorage.removeItem('rouama_admin_token');
    setCurrentPage('accueil');
  };

  return (
    <div className="min-h-screen text-slate-800 flex flex-col justify-between selection:bg-orange-500 selection:text-white">
      {/* Top Header / Banner */}
      <header className="border-b border-orange-200/80 bg-white/90 backdrop-blur-md sticky top-0 z-40 shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-3.5 flex items-center justify-between">
          <button
            onClick={() => setCurrentPage('accueil')}
            className="flex items-center gap-3 text-left group focus:outline-none cursor-pointer"
          >
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-orange-500 to-amber-500 flex items-center justify-center text-white shadow-md shadow-orange-500/20 group-hover:scale-105 transition-transform">
              <Scale className="w-5 h-5" />
            </div>
            <div>
              <div className="font-['Cinzel',serif] tracking-wider text-base sm:text-lg font-bold text-slate-900 flex items-center gap-2">
                ROUAMA
                <span className="text-[10px] uppercase font-sans font-semibold tracking-wider text-orange-700 bg-orange-100 border border-orange-300/80 px-1.5 py-0.5 rounded-full">
                  Officiel
                </span>
              </div>
              <p className="text-[11px] text-slate-500 font-medium">Scrutin Interne 2026</p>
            </div>
          </button>

          <div className="flex items-center gap-2.5 text-xs">
            {status?.isClosed ? (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-rose-50 border border-rose-200 text-rose-700 font-semibold shadow-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-500"></span>
                Scrutin clôturé
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-700 font-semibold shadow-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                Scrutin ouvert
              </span>
            )}

            <button
              onClick={() => {
                if (adminToken) {
                  setCurrentPage('admin_dashboard');
                } else {
                  setAdminCodeInput('');
                  setAdminError(null);
                  setCurrentPage('admin_login');
                }
              }}
              className="ml-1 text-slate-600 hover:text-orange-600 p-2 rounded-lg hover:bg-orange-50 transition-colors cursor-pointer"
              title="Espace Administration"
            >
              <Lock className="w-4 h-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Container */}
      <main className="flex-1 max-w-3xl w-full mx-auto px-4 py-8 sm:py-12 flex flex-col justify-center">
        {/* ================= PAGE 1 : ACCUEIL ================= */}
        {currentPage === 'accueil' && (
          <div className="text-center space-y-8 animate-fadeIn">
            {/* Seal / Badge */}
            <div className="flex justify-center">
              <div className="relative">
                <div className="w-24 h-24 rounded-2xl bg-white border-2 border-orange-300 p-1.5 flex items-center justify-center shadow-xl shadow-orange-950/10">
                  <div className="w-full h-full rounded-xl bg-gradient-to-tr from-orange-50 to-amber-50 border border-orange-200 flex flex-col items-center justify-center">
                    <VoteIcon className="w-10 h-10 text-orange-600" />
                  </div>
                </div>
                <div className="absolute -bottom-2 -right-2 bg-gradient-to-r from-orange-600 to-amber-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-md shadow-md">
                  2026
                </div>
              </div>
            </div>

            {/* Headings */}
            <div className="space-y-3">
              <span className="text-xs font-bold uppercase tracking-[0.25em] text-orange-700 font-sans">
                GROUPE ROUAMA
              </span>
              <h1 className="text-3xl sm:text-4xl md:text-5xl font-extrabold tracking-tight font-['Cinzel',serif] text-slate-900">
                SCRUTIN INTERNE 2026
              </h1>
              <div className="inline-block px-4 py-1.5 rounded-full bg-orange-100 border border-orange-300 text-orange-800 font-bold tracking-wide text-sm sm:text-base shadow-xs">
                ÉLECTION DU PAYOR
              </div>
            </div>

            {/* Official Brief Box - Clean, light & elegant */}
            <div className="max-w-xl mx-auto bg-white border border-orange-200/90 rounded-2xl p-6 sm:p-7 text-slate-700 text-sm sm:text-base leading-relaxed space-y-3 text-left shadow-xl shadow-orange-950/5">
              <p>
                Bienvenue sur la plateforme officielle de vote du groupe <strong className="text-slate-900 font-bold">ROUAMA</strong>.
              </p>
              <p>
                Ce scrutin permet aux membres habilités de se prononcer sur la candidature de <strong className="text-orange-700 font-bold">SYLAS</strong>.
              </p>
              <div className="text-slate-600 text-xs sm:text-sm pt-3 border-t border-orange-100 flex items-center gap-2.5">
                <ShieldCheck className="w-4 h-4 text-orange-600 shrink-0" />
                <span>Chaque électeur dispose d'un seul vote. Confidentialité absolue du scrutin garantie.</span>
              </div>
            </div>

            {/* Action Buttons */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-4 max-w-md mx-auto">
              {status?.isClosed ? (
                <div className="w-full space-y-4">
                  <div className="p-4 rounded-2xl bg-white border border-rose-200 shadow-md text-slate-700 text-sm">
                    <p className="font-bold text-rose-600 text-base mb-1">LE SCRUTIN EST TERMINÉ</p>
                    <p className="text-xs text-slate-500">Les résultats officiels seront communiqués dimanche.</p>
                  </div>
                  <button
                    onClick={() => setCurrentPage('resultats_publics')}
                    className="w-full py-3.5 px-6 rounded-xl font-bold text-slate-800 bg-white hover:bg-orange-50 border border-orange-300 transition-all flex items-center justify-center gap-2 shadow-md cursor-pointer"
                  >
                    <BarChart3 className="w-4 h-4 text-orange-600" />
                    Consulter les résultats officiels
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => {
                    setIdError(null);
                    setCurrentPage('identification');
                  }}
                  className="w-full py-4 px-8 rounded-xl font-bold text-white bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 hover:from-orange-500 hover:to-amber-400 shadow-xl shadow-orange-600/25 hover:shadow-orange-600/35 transform hover:-translate-y-0.5 active:translate-y-0 transition-all text-base tracking-wide flex items-center justify-center gap-2 cursor-pointer"
                >
                  ACCÉDER AU VOTE
                  <ChevronRight className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* Scrutin Schedule Info */}
            <div className="pt-4 flex items-center justify-center text-xs text-slate-600 border-t border-orange-200/80 max-w-lg mx-auto">
              <div className="flex items-center gap-1.5">
                <Calendar className="w-3.5 h-3.5 text-orange-600" />
                <span className="font-medium">Samedi 26 sept. 2026</span>
              </div>
            </div>

            {/* Link to public results if published */}
            {status?.areResultsPublished && (
              <div className="pt-2">
                <button
                  onClick={() => setCurrentPage('resultats_publics')}
                  className="text-orange-700 hover:text-orange-800 text-xs font-semibold underline underline-offset-4 flex items-center justify-center gap-1 mx-auto cursor-pointer"
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  Voir les résultats officiels publiés
                </button>
              </div>
            )}
          </div>
        )}

        {/* ================= PAGE 2 : IDENTIFICATION ================= */}
        {currentPage === 'identification' && (
          <div className="max-w-md mx-auto w-full space-y-6 animate-fadeIn">
            <button
              onClick={() => setCurrentPage('accueil')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Retour à l'accueil
            </button>

            <div className="bg-white border border-orange-200 rounded-2xl p-6 sm:p-8 shadow-xl shadow-orange-950/5 space-y-6">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 mx-auto rounded-xl bg-orange-100 border border-orange-300 flex items-center justify-center text-orange-600 shadow-xs">
                  <UserCheck className="w-6 h-6" />
                </div>
                <h2 className="text-xl sm:text-2xl font-bold font-['Cinzel',serif] text-slate-900">
                  IDENTIFICATION DE L'ÉLECTEUR
                </h2>
                <p className="text-xs text-slate-500">
                  Vérification préalable de votre inscription sur la liste officielle des électeurs du scrutin.
                </p>
              </div>

              <form onSubmit={handleVerifyElector} className="space-y-4">
                <div>
                  <label htmlFor="firstName" className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
                    Votre prénom <span className="text-orange-600">*</span>
                  </label>
                  <input
                    id="firstName"
                    type="text"
                    value={firstNameInput}
                    onChange={(e) => {
                      setFirstNameInput(e.target.value);
                      setIdError(null);
                    }}
                    placeholder="Entrez votre prénom..."
                    className="w-full px-4 py-3 bg-orange-50/50 border border-orange-200 rounded-xl text-slate-900 placeholder-slate-400 focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 text-sm font-medium transition-all"
                    autoFocus
                    required
                  />
                  <p className="text-[11px] text-slate-500 mt-1.5">
                    Saisissez uniquement votre prénom tel qu'enregistré dans le groupe.
                  </p>
                </div>

                {idError && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                    <span className="font-medium leading-relaxed">{idError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={isVerifyingId}
                  className="w-full py-3.5 px-6 rounded-xl font-bold text-white bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-orange-600/20 transition-all text-sm flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isVerifyingId ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Vérification en cours...
                    </>
                  ) : (
                    <>
                      VÉRIFIER ET ACCÉDER AU BULLETIN
                      <ChevronRight className="w-4 h-4" />
                    </>
                  )}
                </button>
              </form>

              <div className="pt-4 border-t border-orange-100 text-[11px] text-slate-500 text-center space-y-1">
                <p>Aucun code requis. Les 11 électeurs sont pré-enregistrés.</p>
                <p className="text-orange-700 font-medium">Sylas est le candidat et ne peut pas voter.</p>
              </div>
            </div>
          </div>
        )}

        {/* ================= PAGE 3 : VOTE ================= */}
        {currentPage === 'vote' && electorName && (
          <div className="max-w-xl mx-auto w-full space-y-6 animate-fadeIn">
            {/* Header info */}
            <div className="flex items-center justify-between pb-3 border-b border-orange-200">
              <div className="text-xs text-slate-600">
                Électeur vérifié : <span className="font-bold text-orange-700 bg-orange-100 px-2 py-0.5 rounded">{electorName}</span>
              </div>
              <button
                onClick={() => {
                  setElectorName(null);
                  setSelectedChoice(null);
                  setJustification('');
                  setCurrentPage('identification');
                }}
                className="text-xs text-slate-500 hover:text-slate-800 transition-colors cursor-pointer"
              >
                Changer d'électeur
              </button>
            </div>

            <div className="text-center space-y-1">
              <h2 className="text-2xl sm:text-3xl font-extrabold font-['Cinzel',serif] text-slate-900">
                VOTE DU SCRUTIN
              </h2>
              <div className="text-orange-700 font-bold text-sm sm:text-base">
                Candidat : WOYA SYLAS
              </div>
              <p className="text-xs text-slate-500 pt-1">
                Veuillez sélectionner l'un des trois choix suivants pour exprimer votre vote.
              </p>
            </div>

            {voteError && (
              <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                <span className="font-medium">{voteError}</span>
              </div>
            )}

            {/* 3 Selectable Choice Cards */}
            <div className="space-y-4">
              {/* CHOIX 1: OUI */}
              <div
                onClick={() => {
                  setSelectedChoice('OUI');
                  setVoteError(null);
                }}
                className={`p-5 rounded-2xl border transition-all cursor-pointer select-none ${
                  selectedChoice === 'OUI'
                    ? 'bg-emerald-50/90 border-emerald-400 ring-2 ring-emerald-400/50 shadow-lg shadow-emerald-600/10'
                    : 'bg-white border-orange-200/90 hover:border-orange-300 hover:bg-orange-50/30 shadow-md shadow-orange-950/5'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-emerald-700">
                        Choix 1
                      </span>
                      {selectedChoice === 'OUI' && (
                        <span className="bg-emerald-100 text-emerald-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-emerald-300">
                          Sélectionné
                        </span>
                      )}
                    </div>
                    <div className="text-xl font-bold text-slate-900 flex items-center gap-2">
                      <Check className="w-5 h-5 text-emerald-600" />
                      OUI
                    </div>
                    <p className="text-sm text-slate-600 italic">
                      "Je vote pour Sylas"
                    </p>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      selectedChoice === 'OUI'
                        ? 'border-emerald-500 bg-emerald-500 text-white'
                        : 'border-slate-300 bg-slate-100'
                    }`}
                  >
                    {selectedChoice === 'OUI' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </div>
              </div>

              {/* CHOIX 2: NON */}
              <div
                onClick={() => {
                  setSelectedChoice('NON');
                  setVoteError(null);
                }}
                className={`p-5 rounded-2xl border transition-all cursor-pointer select-none ${
                  selectedChoice === 'NON'
                    ? 'bg-rose-50/90 border-rose-400 ring-2 ring-rose-400/50 shadow-lg shadow-rose-600/10'
                    : 'bg-white border-orange-200/90 hover:border-orange-300 hover:bg-orange-50/30 shadow-md shadow-orange-950/5'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-rose-700">
                        Choix 2
                      </span>
                      {selectedChoice === 'NON' && (
                        <span className="bg-rose-100 text-rose-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-rose-300">
                          Sélectionné
                        </span>
                      )}
                    </div>
                    <div className="text-xl font-bold text-slate-900 flex items-center gap-2">
                      <X className="w-5 h-5 text-rose-600" />
                      NON
                    </div>
                    <p className="text-sm text-slate-600 italic">
                      "Je ne vote pas pour Sylas"
                    </p>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      selectedChoice === 'NON'
                        ? 'border-rose-500 bg-rose-500 text-white'
                        : 'border-slate-300 bg-slate-100'
                    }`}
                  >
                    {selectedChoice === 'NON' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </div>

                {/* Justification input if NON */}
                {selectedChoice === 'NON' && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="mt-4 pt-4 border-t border-rose-200 space-y-2 cursor-default"
                  >
                    <label htmlFor="non-justif" className="block text-xs font-bold text-rose-900">
                      Veuillez expliquer brièvement les raisons de votre choix <span className="text-rose-600">*</span>
                    </label>
                    <textarea
                      id="non-justif"
                      value={justification}
                      onChange={(e) => {
                        setJustification(e.target.value);
                        setVoteError(null);
                      }}
                      rows={3}
                      placeholder="Indiquez vos raisons ici (obligatoire pour valider le vote)..."
                      className="w-full px-3.5 py-2.5 bg-white border border-rose-300 rounded-xl text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 transition-all resize-none shadow-xs"
                      required
                    />
                    <p className="text-[11px] text-rose-700">
                      Ce champ est obligatoire. Les justifications restent confidentielles et consultables uniquement par le comité d'administration.
                    </p>
                  </div>
                )}
              </div>

              {/* CHOIX 3: JE RESTE NEUTRE */}
              <div
                onClick={() => {
                  setSelectedChoice('NEUTRE');
                  setVoteError(null);
                }}
                className={`p-5 rounded-2xl border transition-all cursor-pointer select-none ${
                  selectedChoice === 'NEUTRE'
                    ? 'bg-amber-50/90 border-amber-400 ring-2 ring-amber-400/50 shadow-lg shadow-amber-600/10'
                    : 'bg-white border-orange-200/90 hover:border-orange-300 hover:bg-orange-50/30 shadow-md shadow-orange-950/5'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-amber-700">
                        Choix 3
                      </span>
                      {selectedChoice === 'NEUTRE' && (
                        <span className="bg-amber-100 text-amber-800 text-[10px] font-bold px-2 py-0.5 rounded-full border border-amber-300">
                          Sélectionné
                        </span>
                      )}
                    </div>
                    <div className="text-xl font-bold text-slate-900 flex items-center gap-2">
                      <MinusCircle className="w-5 h-5 text-amber-600" />
                      JE RESTE NEUTRE
                    </div>
                    <p className="text-sm text-slate-600 italic">
                      "Je ne souhaite pas me prononcer pour ou contre."
                    </p>
                  </div>
                  <div
                    className={`w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                      selectedChoice === 'NEUTRE'
                        ? 'border-amber-500 bg-amber-500 text-white'
                        : 'border-slate-300 bg-slate-100'
                    }`}
                  >
                    {selectedChoice === 'NEUTRE' && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                  </div>
                </div>

                {/* Justification input if NEUTRE */}
                {selectedChoice === 'NEUTRE' && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="mt-4 pt-4 border-t border-amber-200 space-y-2 cursor-default"
                  >
                    <label htmlFor="neutre-justif" className="block text-xs font-bold text-amber-900">
                      Veuillez expliquer brièvement les raisons de votre neutralité <span className="text-amber-600">*</span>
                    </label>
                    <textarea
                      id="neutre-justif"
                      value={justification}
                      onChange={(e) => {
                        setJustification(e.target.value);
                        setVoteError(null);
                      }}
                      rows={3}
                      placeholder="Indiquez vos raisons ici (obligatoire pour valider le vote)..."
                      className="w-full px-3.5 py-2.5 bg-white border border-amber-300 rounded-xl text-slate-900 placeholder-slate-400 text-sm focus:outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 transition-all resize-none shadow-xs"
                      required
                    />
                    <p className="text-[11px] text-amber-700">
                      Ce champ est obligatoire. Les justifications restent confidentielles et consultables uniquement par le comité d'administration.
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Validation Button */}
            <div className="pt-2">
              <button
                type="button"
                onClick={handleProceedToConfirmation}
                disabled={!selectedChoice}
                className="w-full py-4 px-6 rounded-xl font-bold text-white bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 hover:from-orange-500 hover:to-amber-400 disabled:opacity-40 disabled:cursor-not-allowed shadow-xl shadow-orange-600/25 transition-all text-sm tracking-wide flex items-center justify-center gap-2 cursor-pointer"
              >
                CONTINUER VERS LA CONFIRMATION
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* ================= PAGE 4 : CONFIRMATION ================= */}
        {currentPage === 'confirmation' && electorName && selectedChoice && (
          <div className="max-w-md mx-auto w-full space-y-6 animate-fadeIn">
            <div className="bg-white border border-orange-200 rounded-2xl p-6 sm:p-8 shadow-xl shadow-orange-950/5 space-y-6">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 mx-auto rounded-xl bg-orange-100 border border-orange-300 flex items-center justify-center text-orange-600 shadow-xs">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h2 className="text-2xl font-bold font-['Cinzel',serif] text-slate-900">
                  CONFIRMER MON VOTE
                </h2>
                <p className="text-xs text-slate-500">
                  Vérifiez attentivement votre choix avant l'enregistrement final.
                </p>
              </div>

              {/* Vote Summary Card */}
              <div className="bg-orange-50/60 rounded-xl p-5 border border-orange-200 space-y-4">
                <div className="flex items-center justify-between text-xs border-b border-orange-200/80 pb-2.5">
                  <span className="text-slate-600 font-medium">Candidat</span>
                  <span className="font-bold text-slate-900">WOYA SYLAS</span>
                </div>

                <div className="space-y-1">
                  <span className="text-xs text-slate-600 font-medium">Votre choix :</span>
                  <div
                    className={`text-lg font-bold flex items-center gap-2 ${
                      selectedChoice === 'OUI'
                        ? 'text-emerald-700'
                        : selectedChoice === 'NON'
                        ? 'text-rose-700'
                        : 'text-amber-700'
                    }`}
                  >
                    {selectedChoice === 'OUI' && <Check className="w-5 h-5 text-emerald-600" />}
                    {selectedChoice === 'NON' && <X className="w-5 h-5 text-rose-600" />}
                    {selectedChoice === 'NEUTRE' && <MinusCircle className="w-5 h-5 text-amber-600" />}
                    <span>
                      {selectedChoice === 'OUI' && 'OUI — Je vote pour Sylas'}
                      {selectedChoice === 'NON' && 'NON — Je ne vote pas pour Sylas'}
                      {selectedChoice === 'NEUTRE' && 'JE RESTE NEUTRE'}
                    </span>
                  </div>
                </div>

                {(selectedChoice === 'NON' || selectedChoice === 'NEUTRE') && (
                  <div className="pt-2 border-t border-orange-200/80 space-y-1">
                    <span className="text-xs text-slate-600 font-medium">Votre justification :</span>
                    <p className="text-xs text-slate-800 bg-white p-3 rounded-lg border border-orange-200 italic leading-relaxed shadow-2xs">
                      "{justification.trim()}"
                    </p>
                  </div>
                )}
              </div>

              {/* Strict Warning */}
              <div className="p-4 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-start gap-3">
                <AlertCircle className="w-5 h-5 shrink-0 text-amber-600 mt-0.5" />
                <div className="leading-relaxed">
                  <strong className="text-amber-950 font-bold">Attention :</strong> votre vote sera définitif. Vous ne pourrez pas voter une seconde fois.
                </div>
              </div>

              {voteError && (
                <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
                  <span className="font-medium">{voteError}</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="space-y-3 pt-2">
                <button
                  type="button"
                  onClick={handleFinalVoteSubmit}
                  disabled={isSubmittingVote}
                  className="w-full py-4 px-6 rounded-xl font-bold text-white bg-gradient-to-r from-orange-600 via-orange-500 to-amber-500 hover:from-orange-500 hover:to-amber-400 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-orange-600/25 transition-all text-sm tracking-wide flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmittingVote ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></span>
                      Enregistrement définitif...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      CONFIRMER MON VOTE
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => setCurrentPage('vote')}
                  disabled={isSubmittingVote}
                  className="w-full py-3 px-4 rounded-xl font-semibold text-slate-700 hover:text-slate-900 bg-orange-50 hover:bg-orange-100 border border-orange-200 transition-all text-xs flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" />
                  MODIFIER MON CHOIX
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ================= PAGE 5 : VOTE ENREGISTRÉ ================= */}
        {currentPage === 'enregistre' && (
          <div className="max-w-md mx-auto w-full text-center space-y-8 animate-fadeIn">
            <div className="flex justify-center">
              <div className="w-20 h-20 rounded-2xl bg-white border-2 border-emerald-300 p-1.5 flex items-center justify-center shadow-xl shadow-emerald-600/10">
                <div className="w-full h-full rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center text-emerald-600">
                  <CheckCircle2 className="w-10 h-10" />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <span className="text-xs uppercase font-bold tracking-widest text-emerald-700 bg-emerald-100 px-3 py-1 rounded-full border border-emerald-200">
                Scrutin ROUAMA 2026
              </span>
              <h2 className="text-3xl font-extrabold font-['Cinzel',serif] text-slate-900 pt-2">
                VOTE ENREGISTRÉ
              </h2>
              <p className="text-base text-slate-700 font-medium">
                Votre participation au scrutin ROUAMA a bien été enregistrée.
              </p>
              <p className="text-sm font-bold text-orange-700">
                Merci pour votre participation.
              </p>
            </div>

            <div className="bg-white border border-orange-200 rounded-2xl p-5 text-xs text-slate-700 space-y-2 shadow-md shadow-orange-950/5">
              <div className="flex items-center justify-center gap-2 text-slate-800 font-semibold">
                <Calendar className="w-4 h-4 text-orange-600" />
                <span>Les résultats officiels seront communiqués demain dimanche.</span>
              </div>
              <p className="text-[11px] text-slate-500 border-t border-orange-100 pt-2">
                Conformément aux règles du scrutin, votre choix est scellé et anonymisé.
              </p>
            </div>

            <div>
              <button
                onClick={() => setCurrentPage('accueil')}
                className="py-3 px-6 rounded-xl font-bold text-slate-700 hover:text-slate-900 bg-white hover:bg-orange-50 border border-orange-300 text-xs transition-colors shadow-xs cursor-pointer"
              >
                Retour à la page d'accueil
              </button>
            </div>
          </div>
        )}

        {/* ================= PAGE 6 : RÉSULTATS PUBLICS ================= */}
        {currentPage === 'resultats_publics' && (
          <div className="max-w-xl mx-auto w-full space-y-6 animate-fadeIn">
            <button
              onClick={() => setCurrentPage('accueil')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Retour à l'accueil
            </button>

            <div className="bg-white border border-orange-200 rounded-2xl p-6 sm:p-8 shadow-xl shadow-orange-950/5 space-y-6">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 mx-auto rounded-xl bg-orange-100 border border-orange-300 flex items-center justify-center text-orange-600 shadow-xs">
                  <Award className="w-6 h-6" />
                </div>
                <span className="text-xs uppercase font-bold tracking-widest text-orange-700">
                  Publication Officielle
                </span>
                <h2 className="text-2xl sm:text-3xl font-extrabold font-['Cinzel',serif] text-slate-900">
                  RÉSULTATS DU SCRUTIN ROUAMA
                </h2>
                <p className="text-xs text-slate-500">
                  Élection du Payor · Candidat : WOYA SYLAS
                </p>
              </div>

              {!status?.areResultsPublished ? (
                <div className="text-center py-8 px-4 rounded-xl bg-orange-50/60 border border-orange-200 space-y-3">
                  <Lock className="w-8 h-8 text-orange-600/80 mx-auto" />
                  <p className="text-sm font-bold text-slate-800">
                    Les résultats sont actuellement confidentiels.
                  </p>
                  <p className="text-xs text-slate-500 max-w-sm mx-auto">
                    Le dépouillement et la publication des résultats officiels seront effectués dimanche par le comité d'administration.
                  </p>
                </div>
              ) : (
                <div className="space-y-6">
                  {/* Participation */}
                  <div className="p-4 rounded-xl bg-orange-50/70 border border-orange-200 space-y-2">
                    <div className="flex justify-between items-center text-xs">
                      <span className="text-slate-600 font-semibold">Participation :</span>
                      <span className="font-extrabold text-slate-900 text-sm">
                        {status.results?.total || 0} / {status.totalElectors} ({status.results?.participationRate}%)
                      </span>
                    </div>
                    <div className="w-full bg-slate-200 rounded-full h-2.5 overflow-hidden">
                      <div
                        className="bg-gradient-to-r from-orange-500 to-amber-500 h-2.5 rounded-full transition-all duration-500"
                        style={{ width: `${Math.min(100, status.results?.participationRate || 0)}%` }}
                      ></div>
                    </div>
                  </div>

                  {/* Results Breakdown */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center space-y-1">
                      <div className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                        OUI
                      </div>
                      <div className="text-3xl font-extrabold text-emerald-700">
                        {status.results?.oui || 0}
                      </div>
                      <div className="text-[11px] text-emerald-800 font-medium">
                        {status.results?.total
                          ? Math.round(((status.results.oui || 0) / status.results.total) * 100)
                          : 0}% des votes
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-center space-y-1">
                      <div className="text-xs font-bold text-rose-800 uppercase tracking-wider">
                        NON
                      </div>
                      <div className="text-3xl font-extrabold text-rose-700">
                        {status.results?.non || 0}
                      </div>
                      <div className="text-[11px] text-rose-800 font-medium">
                        {status.results?.total
                          ? Math.round(((status.results.non || 0) / status.results.total) * 100)
                          : 0}% des votes
                      </div>
                    </div>

                    <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center space-y-1">
                      <div className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                        NEUTRE
                      </div>
                      <div className="text-3xl font-extrabold text-amber-700">
                        {status.results?.neutre || 0}
                      </div>
                      <div className="text-[11px] text-amber-800 font-medium">
                        {status.results?.total
                          ? Math.round(((status.results.neutre || 0) / status.results.total) * 100)
                          : 0}% des votes
                      </div>
                    </div>
                  </div>

                  {/* Official Mention */}
                  <div className="p-3.5 rounded-xl bg-orange-100/70 border border-orange-300 text-center">
                    <p className="text-xs font-bold text-orange-900 flex items-center justify-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-orange-600" />
                      Résultats officiels du scrutin.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ================= ESPACE ADMIN : LOGIN ================= */}
        {currentPage === 'admin_login' && (
          <div className="max-w-sm mx-auto w-full space-y-6 animate-fadeIn">
            <button
              onClick={() => setCurrentPage('accueil')}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              Retour à l'accueil
            </button>

            <div className="bg-white border border-orange-200 rounded-2xl p-6 sm:p-8 shadow-xl shadow-orange-950/5 space-y-6">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 mx-auto rounded-xl bg-orange-100 border border-orange-300 flex items-center justify-center text-orange-600 shadow-xs">
                  <Lock className="w-6 h-6" />
                </div>
                <h2 className="text-xl font-bold font-['Cinzel',serif] text-slate-900">
                  ESPACE ADMINISTRATION
                </h2>
                <p className="text-xs text-slate-500">
                  Accès réservé aux membres du comité ad hoc.
                </p>
              </div>

              <form onSubmit={handleAdminLogin} className="space-y-4">
                <div>
                  <label htmlFor="adminCode" className="block text-xs font-bold text-slate-700 mb-1.5 uppercase tracking-wider">
                    Code d'accès <span className="text-orange-600">*</span>
                  </label>
                  <input
                    id="adminCode"
                    type="password"
                    maxLength={6}
                    value={adminCodeInput}
                    onChange={(e) => {
                      setAdminCodeInput(e.target.value);
                      setAdminError(null);
                    }}
                    placeholder=""
                    className="w-full text-center text-xl tracking-[0.5em] px-4 py-3 bg-orange-50/50 border border-orange-200 rounded-xl text-slate-900 focus:outline-none focus:bg-white focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20 font-mono transition-all"
                    autoFocus
                    required
                  />
                </div>

                {adminError && (
                  <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-rose-700 text-xs flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
                    <span className="font-medium">{adminError}</span>
                  </div>
                )}

                <button
                  type="submit"
                  className="w-full py-3.5 px-6 rounded-xl font-bold text-white bg-gradient-to-r from-orange-600 to-amber-500 hover:from-orange-500 hover:to-amber-400 shadow-lg shadow-orange-600/20 transition-all text-xs tracking-wide flex items-center justify-center gap-2 cursor-pointer"
                >
                  DÉVERROUILLER L'ESPACE ADMIN
                  <ChevronRight className="w-4 h-4" />
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ================= ESPACE ADMIN : DASHBOARD ================= */}
        {currentPage === 'admin_dashboard' && (
          <div className="max-w-4xl mx-auto w-full space-y-6 animate-fadeIn pb-12">
            {/* Header bar: Clean and elegant title without any duplicate "(AHDOC)" */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-orange-200">
              <div>
                <div className="flex items-center gap-2.5">
                  <h2 className="text-xl sm:text-2xl font-bold font-['Cinzel',serif] text-slate-900">
                    ESPACE ADMINISTRATION
                  </h2>
                  <span className="text-[10px] uppercase font-bold tracking-wider px-2.5 py-0.5 rounded-full bg-orange-100 border border-orange-300 text-orange-800">
                    Comité Ad Hoc
                  </span>
                </div>
                <p className="text-xs text-slate-600">
                  Supervision du scrutin interne du groupe ROUAMA
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => fetchAdminData()}
                  disabled={isLoadingAdmin}
                  className="p-2 rounded-xl bg-white hover:bg-orange-50 text-slate-700 border border-orange-200 transition-colors text-xs flex items-center gap-1.5 cursor-pointer shadow-xs"
                  title="Actualiser"
                >
                  <RotateCcw className={`w-3.5 h-3.5 ${isLoadingAdmin ? 'animate-spin text-orange-600' : ''}`} />
                  <span className="hidden sm:inline font-semibold">Actualiser</span>
                </button>
                <button
                  onClick={handleAdminLogout}
                  className="px-3.5 py-2 rounded-xl bg-white hover:bg-rose-50 text-slate-700 hover:text-rose-700 border border-orange-200 hover:border-rose-300 transition-colors text-xs font-semibold cursor-pointer shadow-xs"
                >
                  Déconnexion
                </button>
              </div>
            </div>

            {adminActionMessage && (
              <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-900 text-xs flex items-center justify-between shadow-xs">
                <span className="font-semibold">{adminActionMessage}</span>
                <button
                  onClick={() => setAdminActionMessage(null)}
                  className="text-amber-700 hover:text-slate-900 font-bold ml-2 cursor-pointer"
                >
                  ×
                </button>
              </div>
            )}

            {/* Scrutin Control Panel */}
            <div className="bg-white border border-orange-200 rounded-2xl p-5 sm:p-6 shadow-xl shadow-orange-950/5 space-y-4">
              <h3 className="text-xs font-bold uppercase tracking-wider text-orange-800 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-orange-600" />
                Gestion du Scrutin
              </h3>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-4 pt-2 border-t border-orange-100">
                <div className="space-y-1">
                  <div className="flex items-center gap-2 text-sm font-bold text-slate-800">
                    <span>État du vote :</span>
                    {adminData?.isClosed ? (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
                        FERMÉ
                      </span>
                    ) : (
                      <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
                        OUVERT
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 text-xs text-slate-600">
                    <span>Visibilité publique :</span>
                    {adminData?.areResultsPublished ? (
                      <span className="text-emerald-700 font-bold">Résultats publiés</span>
                    ) : (
                      <span className="text-amber-700 font-semibold">Résultats confidentiels</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  {/* Close / Reopen button */}
                  {adminData?.isClosed ? (
                    <button
                      onClick={handleReopenScrutin}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-600/20 cursor-pointer"
                    >
                      ROUVRIR LE SCRUTIN
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowCloseConfirmModal(true)}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white transition-all shadow-md shadow-rose-600/20 cursor-pointer"
                    >
                      CLÔTURER LE SCRUTIN
                    </button>
                  )}

                  {/* Publish / Unpublish button: Disabled if scrutin is NOT closed yet! */}
                  {adminData?.areResultsPublished ? (
                    <button
                      onClick={handleUnpublishResults}
                      className="px-4 py-2.5 rounded-xl text-xs font-bold bg-slate-100 hover:bg-slate-200 border border-slate-300 text-slate-700 transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                    >
                      <EyeOff className="w-3.5 h-3.5" />
                      MASQUER LES RÉSULTATS
                    </button>
                  ) : (
                    <div className="relative group">
                      <button
                        onClick={handlePublishResults}
                        disabled={!adminData?.isClosed}
                        className={`px-4 py-2.5 rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 ${
                          adminData?.isClosed
                            ? 'bg-amber-600 hover:bg-amber-500 text-white shadow-md shadow-amber-600/20 cursor-pointer'
                            : 'bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-60'
                        }`}
                        title={
                          !adminData?.isClosed
                            ? 'Le scrutin doit être clôturé avant de pouvoir publier les résultats'
                            : 'Publier les résultats au public'
                        }
                      >
                        <Eye className="w-3.5 h-3.5" />
                        PUBLIER LES RÉSULTATS
                      </button>
                    </div>
                  )}

                  {/* Reset button for testing/fresh start */}
                  <button
                    onClick={() => setShowResetConfirmModal(true)}
                    className="px-3 py-2.5 rounded-xl text-xs font-semibold text-slate-500 hover:text-rose-700 hover:bg-rose-50 transition-colors border border-transparent hover:border-rose-200 cursor-pointer"
                    title="Réinitialiser pour tests"
                  >
                    Réinitialiser
                  </button>
                </div>
              </div>

              {!adminData?.isClosed && (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-800 bg-amber-50 p-2.5 rounded-xl border border-amber-200">
                  <Info className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>
                    <strong>Note :</strong> Le bouton "PUBLIER LES RÉSULTATS" reste inactif tant que le scrutin n'a pas été clôturé.
                  </span>
                </div>
              )}
            </div>

            {/* Metrics Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-white border border-orange-200 rounded-xl p-4 space-y-1 shadow-md shadow-orange-950/5">
                <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                  Total Électeurs
                </span>
                <div className="text-2xl sm:text-3xl font-extrabold text-slate-900">
                  {adminData?.totalElectors ?? 11}
                </div>
                <div className="text-[11px] text-slate-500 font-medium">Membres autorisés</div>
              </div>

              <div className="bg-white border border-orange-200 rounded-xl p-4 space-y-1 shadow-md shadow-orange-950/5">
                <span className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider">
                  Votes Enregistrés
                </span>
                <div className="text-2xl sm:text-3xl font-extrabold text-emerald-700">
                  {adminData?.recordedVotesCount ?? 0}
                </div>
                <div className="text-[11px] text-slate-500 font-medium">Bulletins déposés</div>
              </div>

              <div className="bg-white border border-orange-200 rounded-xl p-4 space-y-1 shadow-md shadow-orange-950/5">
                <span className="text-[11px] font-bold text-amber-700 uppercase tracking-wider">
                  En Attente
                </span>
                <div className="text-2xl sm:text-3xl font-extrabold text-amber-700">
                  {adminData?.notVotedCount ?? 11}
                </div>
                <div className="text-[11px] text-slate-500 font-medium">N'ont pas encore voté</div>
              </div>

              <div className="bg-white border border-orange-200 rounded-xl p-4 space-y-1 shadow-md shadow-orange-950/5">
                <span className="text-[11px] font-bold text-orange-700 uppercase tracking-wider">
                  Participation
                </span>
                <div className="text-2xl sm:text-3xl font-extrabold text-orange-700">
                  {adminData?.participationRate ?? 0}%
                </div>
                <div className="text-[11px] text-slate-500 font-medium">Taux de participation</div>
              </div>
            </div>

            {/* Results Section (Admin Only) */}
            <div className="bg-white border border-orange-200 rounded-2xl p-5 sm:p-6 shadow-xl shadow-orange-950/5 space-y-4">
              <div className="flex items-center justify-between border-b border-orange-100 pb-3">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-orange-800 flex items-center gap-2">
                    <BarChart3 className="w-4 h-4 text-orange-600" />
                    Dépouillement des Résultats
                  </h3>
                  <p className="text-xs text-slate-500">
                    Candidat : WOYA SYLAS · Scrutin uninominal
                  </p>
                </div>
                <span className="text-xs text-slate-600 font-medium">
                  Total : <strong className="text-slate-900 font-bold">{adminData?.results.total ?? 0}</strong> votes
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-1">
                <div className="p-4 rounded-xl bg-emerald-50 border border-emerald-200 text-center space-y-1">
                  <div className="text-xs font-bold text-emerald-800 uppercase tracking-wider">
                    OUI
                  </div>
                  <div className="text-3xl font-extrabold text-emerald-700">
                    {adminData?.results.oui ?? 0}
                  </div>
                  <div className="text-xs text-emerald-800 font-medium">
                    {adminData?.results.total
                      ? Math.round(((adminData.results.oui || 0) / adminData.results.total) * 100)
                      : 0}%
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-rose-50 border border-rose-200 text-center space-y-1">
                  <div className="text-xs font-bold text-rose-800 uppercase tracking-wider">
                    NON
                  </div>
                  <div className="text-3xl font-extrabold text-rose-700">
                    {adminData?.results.non ?? 0}
                  </div>
                  <div className="text-xs text-rose-800 font-medium">
                    {adminData?.results.total
                      ? Math.round(((adminData.results.non || 0) / adminData.results.total) * 100)
                      : 0}%
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-amber-50 border border-amber-200 text-center space-y-1">
                  <div className="text-xs font-bold text-amber-800 uppercase tracking-wider">
                    NEUTRE
                  </div>
                  <div className="text-3xl font-extrabold text-amber-700">
                    {adminData?.results.neutre ?? 0}
                  </div>
                  <div className="text-xs text-amber-800 font-medium">
                    {adminData?.results.total
                      ? Math.round(((adminData.results.neutre || 0) / adminData.results.total) * 100)
                      : 0}%
                  </div>
                </div>
              </div>
            </div>

            {/* Justifications Section */}
            <div className="bg-white border border-orange-200 rounded-2xl p-5 sm:p-6 shadow-xl shadow-orange-950/5 space-y-4">
              <div className="border-b border-orange-100 pb-3">
                <h3 className="text-sm font-bold uppercase tracking-wider text-orange-800 flex items-center gap-2">
                  <HelpCircle className="w-4 h-4 text-orange-600" />
                  JUSTIFICATIONS (NON et NEUTRE)
                </h3>
                <p className="text-xs text-slate-500">
                  Raisons fournies par les électeurs ayant choisi NON ou NEUTRE (confidentiel).
                </p>
              </div>

              {!adminData?.justifications || adminData.justifications.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-400">
                  Aucune justification enregistrée pour le moment.
                </div>
              ) : (
                <div className="space-y-3 pt-1">
                  {adminData.justifications.map((item, idx) => (
                    <div
                      key={item.id || idx}
                      className="p-4 rounded-xl bg-orange-50/40 border border-orange-200 space-y-2 text-xs"
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`font-bold px-2.5 py-0.5 rounded text-[11px] ${
                            item.choice === 'NON'
                              ? 'bg-rose-100 text-rose-800 border border-rose-300'
                              : 'bg-amber-100 text-amber-800 border border-amber-300'
                          }`}
                        >
                          Choix : {item.choice}
                        </span>
                        <span className="text-[11px] text-slate-400 font-medium">
                          {new Date(item.timestamp).toLocaleTimeString('fr-FR', {
                            hour: '2-digit',
                            minute: '2-digit',
                            second: '2-digit'
                          })}
                        </span>
                      </div>
                      <p className="text-slate-800 leading-relaxed italic bg-white p-3 rounded-lg border border-orange-200 shadow-2xs">
                        "{item.justification}"
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Registered Electors List */}
            <div className="bg-white border border-orange-200 rounded-2xl p-5 sm:p-6 shadow-xl shadow-orange-950/5 space-y-4">
              <div className="border-b border-orange-100 pb-3 flex justify-between items-center">
                <div>
                  <h3 className="text-sm font-bold uppercase tracking-wider text-orange-800 flex items-center gap-2">
                    <Users className="w-4 h-4 text-orange-600" />
                    LISTE DES 11 ÉLECTEURS AUTORISÉS
                  </h3>
                  <p className="text-xs text-slate-500">
                    Statut individuel de participation (le secret du choix est scrupuleusement préservé).
                  </p>
                </div>
                <div className="text-xs text-slate-600">
                  <span className="text-emerald-700 font-bold">{adminData?.recordedVotesCount || 0}</span> / 11 ont voté
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5 pt-1">
                {adminData?.electors.map((elector) => (
                  <div
                    key={elector.name}
                    className={`p-3 rounded-xl border flex items-center justify-between text-xs transition-colors ${
                      elector.hasVoted
                        ? 'bg-emerald-50/70 border-emerald-200 text-slate-900 shadow-2xs'
                        : 'bg-slate-50 border-slate-200 text-slate-500'
                    }`}
                  >
                    <div className="font-bold tracking-wide flex items-center gap-2">
                      <span
                        className={`w-2 h-2 rounded-full ${
                          elector.hasVoted ? 'bg-emerald-500' : 'bg-slate-300'
                        }`}
                      ></span>
                      {elector.name}
                    </div>

                    <div>
                      {elector.hasVoted ? (
                        <span className="inline-flex items-center gap-1 font-bold text-[10px] uppercase text-emerald-800 bg-emerald-100 px-2 py-0.5 rounded border border-emerald-300">
                          <Check className="w-3 h-3 text-emerald-700" />
                          A voté
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                          En attente
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className="p-3 rounded-xl bg-orange-50 border border-orange-200 text-[11px] text-slate-600 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-orange-600 shrink-0" />
                <span>
                  Sylas est exclu de cette liste et ne peut pas voter. Le vote de chaque électeur reste strictement confidentiel.
                </span>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Confirmation Modal for Clôture Scrutin */}
      {showCloseConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white border border-rose-200 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-xl bg-rose-100 border border-rose-300 flex items-center justify-center text-rose-600 mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-lg font-bold text-slate-900">Clôturer le scrutin ?</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Êtes-vous certain de vouloir clôturer le scrutin ? Cette action empêchera tout nouveau vote.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowCloseConfirmModal(false)}
                className="w-1/2 py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleCloseScrutin}
                className="w-1/2 py-2.5 px-4 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold transition-colors shadow-md shadow-rose-600/20 cursor-pointer"
              >
                Oui, clôturer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Modal for Reset Scrutin */}
      {showResetConfirmModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs animate-fadeIn">
          <div className="bg-white border border-amber-200 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-600 mx-auto">
              <RotateCcw className="w-6 h-6" />
            </div>

            <div className="text-center space-y-2">
              <h3 className="text-lg font-bold text-slate-900">Réinitialiser le scrutin ?</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Attention : Cette action efface tous les votes enregistrés et remet les 11 électeurs à zéro.
              </p>
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setShowResetConfirmModal(false)}
                className="w-1/2 py-2.5 px-4 rounded-xl border border-slate-200 hover:bg-slate-50 text-slate-700 text-xs font-bold transition-colors cursor-pointer"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleResetScrutin}
                className="w-1/2 py-2.5 px-4 rounded-xl bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold transition-colors shadow-md shadow-amber-600/20 cursor-pointer"
              >
                Confirmer
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <footer className="border-t border-orange-200/80 bg-white/80 backdrop-blur-md py-4 text-center text-xs text-slate-600">
        <div className="max-w-4xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-2">
          <div>
            GROUPE ROUAMA · Scrutin Interne 2026 · Élection du Payor
          </div>
          <div className="flex items-center gap-4 text-[11px]">
            <button
              onClick={() => setCurrentPage('resultats_publics')}
              className="hover:text-orange-700 transition-colors font-medium cursor-pointer"
            >
              Résultats
            </button>
            <span className="text-orange-300">·</span>
            <button
              onClick={() => {
                if (adminToken) {
                  setCurrentPage('admin_dashboard');
                } else {
                  setAdminCodeInput('');
                  setAdminError(null);
                  setCurrentPage('admin_login');
                }
              }}
              className="hover:text-orange-700 transition-colors font-medium flex items-center gap-1 cursor-pointer"
            >
              <Lock className="w-3 h-3 text-orange-600" />
              Espace Administration
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}
