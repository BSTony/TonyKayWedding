import { initializeApp } from "firebase/app";
import { getDatabase, ref, set, get, push, update, onValue, remove, serverTimestamp, increment } from "firebase/database";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged } from "firebase/auth";

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

export { db, ref, set, get, push, update, onValue, remove, serverTimestamp, increment, auth, googleProvider, signInWithPopup, signOut, onAuthStateChanged };

