import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./i18n/index.ts";
import "./styles.css";
import App from "./App.tsx";
import { captureInstallPrompt } from "./utils/installPrompt.ts";

captureInstallPrompt();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
