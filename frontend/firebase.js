import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, push, update, onValue, remove, serverTimestamp, increment, onDisconnect } from "firebase/database";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDxa_23r4kv_iRFFMp-9IYjNN6D6ryz6mI",
  authDomain: "tonykaywendding.firebaseapp.com",
  databaseURL: "https://tonykaywendding-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: "tonykaywendding",
  storageBucket: "tonykaywendding.firebasestorage.app",
  messagingSenderId: "313808662625",
  appId: "1:313808662625:web:38ec4853fc53e5844fba20",
  measurementId: "G-M91TGGVLRJ"
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// 🌟 自動為訪客簽發 Firebase 匿名安全憑證 (auth != null)，保障安全且不影響訪客遊玩
onAuthStateChanged(auth, (user) => {
  if (!user) {
    signInAnonymously(auth).catch((err) => {
      console.warn('Anonymous auth sync info:', err);
    });
  }
});

export { db, ref, set, get, push, update, onValue, remove, serverTimestamp, increment, onDisconnect, auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged, signInAnonymously };


