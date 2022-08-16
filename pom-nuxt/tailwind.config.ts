/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./components/**/*.{js,vue,ts}",
    "./layouts/**/*.vue",
    "./pages/**/*.vue",
    "./composables/**/*.{js,ts}",
    "./plugins/**/*.{js,ts}",
    "./app.{js,ts,vue}",
  ],
  plugins: [require("daisyui")],
  theme: {
    extend: {
      backgroundImage: {
        "home-about": "url('public/bg-moon.png')",
        "home-stats": "url('public/bg-stars.png')",
        "home-winners": "url('public/bg-jupiter.png')",
        "home-gameplay": "url('public/bg-dark-moon.png')",
        login: "url('public/bg-dark-moon.png')",
      },
      colors: {
        main: "#9C5147",
        "light-accent": "#CAA66E",
        "dark-accent": "#A49CA6",
        "dark-shade": "#221A1B",
        "light-shade": "#F1E0C5",
      },
    },
  },
};