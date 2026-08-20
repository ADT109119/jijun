/**
 * Tailwind 本地 build 管線的 theme config（取代 Play CDN runtime JIT）。
 * 由 PostCSS 在 `npm run build` 時執行，產出靜態 CSS。
 *
 * 注意：本檔與舊的 public/tailwind.config.js 內容一致（wabi-* 主題 + font-display），
 * 但用途改為 build-time，不再是 runtime `tailwind.config = {...}` 賦值。
 */
import formsPlugin from '@tailwindcss/forms'

const colors = [
    'slate',
    'gray',
    'zinc',
    'neutral',
    'stone',
    'red',
    'orange',
    'amber',
    'yellow',
    'lime',
    'green',
    'emerald',
    'teal',
    'cyan',
    'sky',
    'blue',
    'indigo',
    'violet',
    'purple',
    'fuchsia',
    'pink',
    'rose',
]

const colorRegex = colors.join('|')

export default {
    darkMode: 'class',
    content: ['./index.html', './src/**/*.{js,html,css}'],
    safelist: [
        {
            pattern: new RegExp(
                `^bg-(${colorRegex})-(50|100|200|300|400|500|600|700|800|900|950)$`
            ),
            variants: ['hover', 'focus'],
        },
        {
            pattern: new RegExp(
                `^text-(${colorRegex})-(50|100|200|300|400|500|600|700|800|900|950)$`
            ),
            variants: ['hover'],
        },
        {
            pattern: new RegExp(
                `^border-(${colorRegex})-(50|100|200|300|400|500|600|700|800|900|950)$`
            ),
            variants: ['hover'],
        },
        {
            pattern: new RegExp(
                `^bg-(${colorRegex})-(50|100|200|300|400|500|600|700|800|900|950)/(5|10|20|30|40|50|60|70|80|90)$`
            ),
            variants: ['hover'],
        },
        {
            pattern: new RegExp(
                `^text-(${colorRegex})-(50|100|200|300|400|500|600|700|800|900|950)/(5|10|20|30|40|50|60|70|80|90)$`
            ),
        },
        {
            pattern: new RegExp(
                `^border-(${colorRegex})-(50|100|200|300|400|500|600|700|800|900|950)/(5|10|20|30|40|50|60|70|80|90)$`
            ),
        },
        {
            pattern: new RegExp(
                `^ring-(${colorRegex})-(50|100|200|300|400|500|600|700|800|900|950)(/(5|10|20|30|40|50|60|70|80|90))?$`
            ),
        },
    ],
    theme: {
        extend: {
            colors: {
                'wabi-bg':
                    'rgb(var(--theme-bg, 245 245 243) / <alpha-value>)',
                'wabi-primary':
                    'rgb(var(--theme-primary, 51 74 82) / <alpha-value>)',
                'wabi-expense':
                    'rgb(var(--theme-expense, 185 90 90) / <alpha-value>)',
                'wabi-income':
                    'rgb(var(--theme-income, 106 156 137) / <alpha-value>)',
                'wabi-accent':
                    'rgb(var(--theme-accent, 226 182 122) / <alpha-value>)',
                'wabi-text-primary':
                    'rgb(var(--theme-text-primary, 45 55 72) / <alpha-value>)',
                'wabi-text-secondary':
                    'rgb(var(--theme-text-secondary, 113 128 150) / <alpha-value>)',
                'wabi-surface':
                    'rgb(var(--theme-surface, 255 255 255) / <alpha-value>)',
                'wabi-border':
                    'rgb(var(--theme-border, 226 232 240) / <alpha-value>)',
                'wabi-keypad':
                    'rgb(var(--theme-keypad, 229 231 235) / <alpha-value>)',
            },
            fontFamily: {
                display: ['Inter', 'Noto Sans TC', 'sans-serif'],
            },
        },
    },
    plugins: [formsPlugin],
}
