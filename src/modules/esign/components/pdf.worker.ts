// pdf.js parses PDFs in a worker, off the page's main thread. Started from pdf-pages.tsx with
// `new Worker(new URL('./pdf.worker.ts', import.meta.url))` so the bundler serves it from our
// own origin; no script is loaded from anywhere else.
import 'pdfjs-dist/build/pdf.worker.min.mjs';
