import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: {
            "@": path.resolve(__dirname, "./src"),
        },
    },
    test: {
        environment: "jsdom",
        globals: true,
        setupFiles: ["./vitest.setup.js"],
        css: false,
        restoreMocks: true,
        include: ["src/**/*.{test,spec}.{js,jsx}", "tests/**/*.{test,spec}.{js,jsx}"],
        exclude: ["node_modules", "dist"],
    },
});
