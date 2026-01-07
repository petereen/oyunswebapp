/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ocean: {
          50: "#f3f8ff",
          100: "#e4eeff",
          200: "#c3d8ff",
          500: "#2563eb",
          600: "#1d4ed8",
          700: "#1e3a8a"
        },
      },
      boxShadow: {
        card: "0 15px 40px rgba(37,99,235,0.08)",
      },
    },
  },
  plugins: [],
};
