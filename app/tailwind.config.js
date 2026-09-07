/** Tokens come from the design spec. Nothing outside this file invents a colour. */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "#fbf6ec",
        sand: "#f4ecdd",
        "sand-dark": "#efe3cc",
        line: "#e6dac4",
        bark: "#6f5334",
        plank: "#8a6a44",
        terracotta: "#b8552f",
        "terracotta-dark": "#93401f",
        gold: "#f2cf7a",
        "gold-ink": "#6b4d16",
        sage: "#9fc7b2",
        "sage-ink": "#2f5546",
        slate: "#dfe4ee",
        "slate-ink": "#3f4f73",
        ink: "#33291f",
        muted: "#7a6a58",
        faint: "#9a8a76",
        cream: "#fff7ee",
        grass: "#b9c78a",
      },
      fontFamily: {
        display: ["Fredoka", "Nunito", "system-ui", "sans-serif"],
        body: ["Nunito", "Segoe UI", "system-ui", "sans-serif"],
      },
      boxShadow: {
        // The chunky drop edge every pressable thing carries.
        drop: "0 4px 0 #6f5334",
        "drop-lg": "0 6px 0 #6f5334",
        panel: "0 6px 0 #6f5334, 0 14px 28px rgba(51, 41, 31, 0.28)",
      },
      keyframes: {
        pop: {
          "0%": { transform: "scale(0.85)", opacity: "0" },
          "60%": { transform: "scale(1.03)", opacity: "1" },
          "100%": { transform: "scale(1)", opacity: "1" },
        },
        fly: {
          "0%": { transform: "translate(0, 0) scale(1)", opacity: "1" },
          "70%": { opacity: "1" },
          "100%": { transform: "var(--fly-to)", opacity: "0" },
        },
        flash: {
          "0%, 100%": { transform: "scale(1)" },
          "50%": { transform: "scale(1.12)" },
        },
      },
      animation: {
        pop: "pop 420ms cubic-bezier(0.2, 0.9, 0.3, 1.2) both",
        fly: "fly 1100ms cubic-bezier(0.3, 0.7, 0.4, 1) 500ms both",
        flash: "flash 320ms ease-out",
      },
    },
  },
  plugins: [],
};
