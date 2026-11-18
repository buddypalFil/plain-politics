// Firebase web config for the Plain Politics project. These values are
// public by design (they identify the project, they are not secrets).
// Security comes from App Check and the Firestore rules.

export const firebaseConfig = {
  apiKey: "AIzaSyBFdo_roHV2J7JPFJkvs9iF2leHkkpUFeg",
  authDomain: "plain-politics-app.firebaseapp.com",
  projectId: "plain-politics-app",
  storageBucket: "plain-politics-app.firebasestorage.app",
  messagingSenderId: "292408643345",
  appId: "1:292408643345:web:b0b1f5cfa43e313cfc46b0",
};

// reCAPTCHA (Fraud Defense) site key used by App Check on the live site (also public).
export const recaptchaSiteKey = "6Lfj0SYuAAAAAHLaGeeTTAm68-_I-AmmGRnTvGGp";
