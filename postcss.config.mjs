import tailwindcss from "@tailwindcss/postcss";

const config = {
  plugins: [
    tailwindcss({
      config: "./tailwind.config.js",
    }),
  ],
};

export default config;
