import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyAlhj02ShfQIOSxLCD3MLytVrSs51CGXY",
  authDomain: "d-orders-77908.firebaseapp.com",
  projectId: "d-orders-77908",
  storageBucket: "d-orders-77908.firebasestorage.app",
  messagingSenderId: "37225087778",
  appId: "1:37225087778:web:1cb46deda1feca6fee1b7b",
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);