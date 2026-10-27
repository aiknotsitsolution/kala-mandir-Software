import { hasApiConfig } from "@/config/env";
import { ApiAuthProvider } from "@/data/api/auth";
import { ApiDataService } from "@/data/api/service";
/**
 * Service locator (real backend only).
 *
 * Mode selection:
 *  - VITE_API_URL set (or production fallback) -> live REST backend (JWT auth).
 */
let authService = null;
let dataService = null;
let dataServiceKey = null;
export function getAuthProvider() {
    if (authService)
        return authService;
    authService = new ApiAuthProvider();
    return authService;
}
export function getDataService(session) {
    const key = `api:${session.gym.id}`;
    if (dataService && dataServiceKey === key)
        return dataService;
    dataService = new ApiDataService(session.gym.id);
    dataServiceKey = key;
    return dataService;
}
export function resetDataService() {
    dataService = null;
    dataServiceKey = null;
}
export function appMode() {
    return hasApiConfig ? "api" : "unconfigured";
}