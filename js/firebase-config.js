/* =====================================================================
   firebase-config.js — turns on shared sync.

   While this is null the app runs exactly as before: everything stays on
   the device it was entered on.

   To share one live list across everyone's phones, paste the config from
   Firebase console → Project settings → Your apps → Web app → "Config":

   window.FIREBASE_CONFIG = {
     apiKey: "AIza...",
     authDomain: "your-project.firebaseapp.com",
     projectId: "your-project",
     storageBucket: "your-project.appspot.com",
     messagingSenderId: "1234567890",
     appId: "1:1234567890:web:abc123"
   };

   These values are not secret — they identify the project. Access is
   controlled by the rules in firestore.rules. See README → Shared sync.
   ===================================================================== */

window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyDZD1J0yP6oaCY1HibiOMVjmLk0Su3_TLs",
  authDomain: "euroluxinternalglazing.firebaseapp.com",
  projectId: "euroluxinternalglazing",
  storageBucket: "euroluxinternalglazing.firebasestorage.app",
  messagingSenderId: "910487890181",
  appId: "1:910487890181:web:c756a74cf0945ef4fd6f6c"
};
