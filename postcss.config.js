// PostCSS 管線：Tailwind 3 本地 build（取代 Play CDN runtime JIT）
// 只在 Vite build 時執行（dev 模式 Vite 也會跑 PostCSS，
// 但 dev 速度可接受；若想 dev 加速可另設 dev-only 配置）。
export default {
    plugins: {
        tailwindcss: {
            config: './tailwind.config.js',
        },
        autoprefixer: {},
    },
}
