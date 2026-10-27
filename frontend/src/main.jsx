import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { applyTheme, readCachedTheme } from "@/lib/theme";
// Apply the cached institute theme before first paint to avoid a flash.
applyTheme(readCachedTheme());
const container = document.getElementById("root");
if (!container)
    throw new Error("Root container #root is missing from index.html");
createRoot(container).render(<StrictMode>
    <App />
  </StrictMode>);
