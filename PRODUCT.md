# Paperwork

Platform: web. Stack: strict TypeScript, PDF.js, pdf-lib, fontkit, Vite, independently served static Cloudflare assets.

People completing everyday PDF forms need native field editing, freehand writing and a visible signature together. Open → fill/draw/sign → save or print. No account or uploaded document. The supplied owner brief in App Composer #264 owns intent.

One document model holds native values and additions. Source PDF content stays intact; changes are serialized to actual fields/appearance streams and page content. No certificate signing, workflow engine, OCR or cloud processing. Private documents and signatures remain in session memory.
