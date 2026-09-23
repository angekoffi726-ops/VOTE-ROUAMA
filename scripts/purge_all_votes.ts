import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  writeBatch,
  doc,
  setDoc
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBhTmSZTXBIzFJ0z27NG5B_zN8JtT2necg",
  authDomain: "rouama-vote.firebaseapp.com",
  projectId: "rouama-vote",
  storageBucket: "rouama-vote.firebasestorage.app",
  messagingSenderId: "649240559564",
  appId: "1:649240559564:web:9ec6fd5293ec6882e5a769",
  measurementId: "G-1ERFVKDBR6"
};

const AUTHORIZED_ELECTORS = [
  "OTINEL",
  "ESTHER",
  "LEGER",
  "ROXANE",
  "GILBERT",
  "EMILE",
  "DESIRE",
  "CYPRIEN",
  "ULRICH",
  "WILFRIED",
  "JOSIANE"
];

async function purgeAll() {
  console.log("Connecting to Firebase Firestore (rouama-vote)...");
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const batch = writeBatch(db);

  // 1. Delete all votes, bulletins, justifications
  const collectionsToDelete = ["votes", "bulletins", "justifications"];
  for (const collName of collectionsToDelete) {
    try {
      const snap = await getDocs(collection(db, collName));
      console.log(`Found ${snap.size} documents in collection '${collName}'`);
      snap.forEach((d) => {
        console.log(`  Scheduling delete for ${collName}/${d.id}`);
        batch.delete(d.ref);
      });
    } catch (e: any) {
      console.error(`Error reading ${collName}:`, e.message);
    }
  }

  // 2. Reset voters, electors, users
  const voterCollections = ["voters", "electors", "users"];
  for (const collName of voterCollections) {
    try {
      const snap = await getDocs(collection(db, collName));
      console.log(`Found ${snap.size} documents in collection '${collName}'`);
      snap.forEach((d) => {
        batch.set(d.ref, { hasVoted: false, votedAt: null }, { merge: true });
      });
    } catch (e: any) {
      console.error(`Error reading ${collName}:`, e.message);
    }
  }

  // Ensure all 11 authorized electors are explicitly reset
  for (const name of AUTHORIZED_ELECTORS) {
    batch.set(doc(db, "voters", name), { name, hasVoted: false, votedAt: null }, { merge: true });
    batch.set(doc(db, "electors", name), { name, hasVoted: false, votedAt: null }, { merge: true });
    batch.set(doc(db, "users", name), { name, hasVoted: false, votedAt: null }, { merge: true });
  }

  // 3. Reset scrutin config & results
  batch.set(doc(db, "scrutin", "config"), {
    isClosed: false,
    areResultsPublished: false,
    candidateName: "WOYA SYLAS",
    totalElectors: 11
  }, { merge: true });

  batch.set(doc(db, "scrutin", "results"), {
    oui: 0,
    non: 0,
    neutre: 0,
    total: 0,
    updatedAt: new Date().toISOString()
  }, { merge: true });

  console.log("Committing writeBatch to Firebase Firestore...");
  await batch.commit();
  console.log("SUCCESS: All votes physically purged, all 11 electors reset to hasVoted=false, counters set to 0.");
  process.exit(0);
}

purgeAll().catch((err) => {
  console.error("Purge failed:", err);
  process.exit(1);
});
