import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PDFDocument, rgb, degrees } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { Mail, FileUp, Download, Loader2, MousePointerClick, RotateCcw, Shuffle } from 'lucide-react';

const HANDWRITING_FONTS = {
  homemadeApple: { label: 'Homemade Apple (pen handwriting)', file: 'HomemadeApple-Regular.ttf' },
  laBelleAurore: { label: 'La Belle Aurore (neat cursive)', file: 'LaBelleAurore-Regular.ttf' },
  nothingYouCouldDo: { label: 'Nothing You Could Do (casual print)', file: 'NothingYouCouldDo-Regular.ttf' },
  pinyon: { label: 'Pinyon Script (matches envelopes)', file: 'PinyonScript-Regular.ttf' },
};

const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'prof']);

// "MEGAN smith" -> "Megan", "anne-marie jones" -> "Anne-Marie", "Mrs. Jane Doe" -> "Jane"
const capitalizeName = (str) => str.toLowerCase().replace(/(^|[\s'-])(\p{L})/gu, (m, sep, ch) => sep + ch.toUpperCase());

export const getFirstName = (subscriber) => {
  const source = subscriber.firstName
    || (subscriber.isStructured ? subscriber.name : (subscriber.raw || '').split(/\r?\n/)[0])
    || '';
  const words = source.trim().split(/\s+/).filter(Boolean);
  const first = words.find(w => !HONORIFICS.has(w.toLowerCase().replace(/\./g, ''))) || '';
  return capitalizeName(first);
};

const getFullName = (subscriber) => {
  const name = subscriber.isStructured ? subscriber.name : (subscriber.raw || '').split(/\r?\n/)[0];
  return capitalizeName((name || '').trim());
};

// Page sizes in PDF points (72 per inch). The letter image is scaled to fit and centered.
const PAGE_SIZES = {
  letter: { label: 'US Letter (8.5 × 11 in)', width: 612, height: 792 },
  a4: { label: 'A4 (210 × 297 mm)', width: 595.28, height: 841.89 },
  fiveBySeven: { label: '5 × 7 in', width: 360, height: 504 },
  image: { label: 'Match image (300 DPI)', width: null, height: null },
};

const getPageSize = (key, image) => {
  const size = PAGE_SIZES[key];
  const portrait = image.width <= image.height;
  if (size.width === null) return { width: image.width * 72 / 300, height: image.height * 72 / 300 };
  return portrait ? { width: size.width, height: size.height } : { width: size.height, height: size.width };
};

// Where the image sits on the page, in PDF points from the bottom-left corner
const getImageBox = (page, image) => {
  const scale = Math.min(page.width / image.width, page.height / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  return { x: (page.width - width) / 2, y: (page.height - height) / 2, width, height };
};

const defaultGreeting = (page) => ({ x: 72, y: page.height - 108, fontSize: 24 });

// Small random tilt and shift per letter so the greetings look hand-written.
// Derived from a seed so the preview matches the download exactly.
const MAX_TILT_DEGREES = 5;
const MAX_SHIFT_X = 5; // points
const MAX_SHIFT_Y = 3; // points, kept smaller so the name doesn't drift into the body text

const newSeed = () => Math.floor(Math.random() * 2 ** 31);

const getJitter = (seed, index) => {
  // mulberry32
  let t = (seed + Math.imul(index + 1, 0x9E3779B9)) >>> 0;
  const next = () => {
    t = (t + 0x6D2B79F5) >>> 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return (((r ^ (r >>> 14)) >>> 0) / 4294967296) * 2 - 1; // -1..1
  };
  return { angle: next() * MAX_TILT_DEGREES, dx: next() * MAX_SHIFT_X, dy: next() * MAX_SHIFT_Y };
};

const NO_JITTER = { angle: 0, dx: 0, dy: 0 };

const loadImage = (url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onload = () => resolve(img);
  img.onerror = reject;
  img.src = url;
});

export default function LetterPersonalizer({ subscribers }) {
  const [letter, setLetter] = useState(null); // { bytes, type, url, width, height }
  const [letterName, setLetterName] = useState('');
  const [pageSizeKey, setPageSizeKey] = useState('letter');
  const [fontKey, setFontKey] = useState('homemadeApple');
  const [fontCache, setFontCache] = useState({});
  const [fontSize, setFontSize] = useState(24);
  // Greeting start, as a fraction of the letter image (0,0 = top left), so it
  // stays on the same spot of the artwork when the paper size changes
  const [position, setPosition] = useState(null);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [previewSrc, setPreviewSrc] = useState('');
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const [varyGreeting, setVaryGreeting] = useState(true);
  const [jitterSeed, setJitterSeed] = useState(newSeed);
  const imgRef = useRef(null);

  const recipients = subscribers
    .map(s => ({ subscriber: s, firstName: getFirstName(s), fullName: getFullName(s) }))
    .filter(r => r.firstName);
  const skipped = subscribers.length - recipients.length;
  const previewRecipient = recipients[Math.min(previewIndex, recipients.length - 1)];
  const previewName = previewRecipient ? previewRecipient.firstName : 'Megan';
  const previewRecipientIndex = Math.max(0, Math.min(previewIndex, recipients.length - 1));
  const jitterFor = (index) => (varyGreeting ? getJitter(jitterSeed, index) : NO_JITTER);

  const page = letter ? getPageSize(pageSizeKey, letter) : null;
  const box = letter ? getImageBox(page, letter) : null;

  // Greeting baseline in PDF points from the bottom-left of the page
  const greetingPoint = () => ({
    x: box.x + position.fx * box.width,
    y: box.y + box.height - position.fy * box.height,
  });

  const getFontBytes = useCallback(async (key) => {
    if (fontCache[key]) return fontCache[key];
    const res = await fetch(`${import.meta.env.BASE_URL}fonts/${HANDWRITING_FONTS[key].file}`);
    if (!res.ok) throw new Error('Could not load the handwriting font.');
    const bytes = new Uint8Array(await res.arrayBuffer());
    setFontCache(prev => ({ ...prev, [key]: bytes }));
    return bytes;
  }, [fontCache]);

  const getDefaultPosition = (img) => {
    const p = getPageSize(pageSizeKey, img);
    const b = getImageBox(p, img);
    const d = defaultGreeting(p);
    return {
      fx: Math.min(Math.max((d.x - b.x) / b.width, 0), 1),
      fy: Math.min(Math.max((b.y + b.height - d.y) / b.height, 0), 1),
    };
  };

  const handleLetterUpload = async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setPreviewSrc('');
    const type = file.type === 'image/png' || /\.png$/i.test(file.name) ? 'png'
      : file.type === 'image/jpeg' || /\.jpe?g$/i.test(file.name) ? 'jpg' : null;
    if (!type) {
      setError('Please upload a PNG or JPG image of the letter.');
      return;
    }
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const url = URL.createObjectURL(file);
      const img = await loadImage(url);
      if (letter) URL.revokeObjectURL(letter.url);
      const next = { bytes, type, url, width: img.naturalWidth, height: img.naturalHeight, img };
      setLetter(next);
      setLetterName(file.name);
      setPosition(getDefaultPosition(next));
      setFontSize(24);
      setJitterSeed(newSeed());
    } catch (err) {
      console.error(err);
      setError('Could not read that image. Please make sure it is a valid PNG or JPG file.');
    }
  };

  // Re-render the preview whenever the letter, name, font, size, paper or position changes
  useEffect(() => {
    if (!letter || !position) return;
    let cancelled = false;
    const render = async () => {
      setPreviewLoading(true);
      try {
        const family = `Greeting_${fontKey}`;
        const fontBytes = await getFontBytes(fontKey);
        if (![...document.fonts].some(f => f.family === family)) {
          const face = new FontFace(family, fontBytes);
          await face.load();
          document.fonts.add(face);
        }
        const k = 1400 / page.height; // canvas pixels per PDF point
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(page.width * k);
        canvas.height = Math.round(page.height * k);
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(letter.img, box.x * k, (page.height - box.y - box.height) * k, box.width * k, box.height * k);
        const { x, y } = greetingPoint();
        const jitter = jitterFor(previewRecipientIndex);
        ctx.font = `${fontSize * k}px "${family}"`;
        ctx.fillStyle = 'rgb(20, 20, 31)';
        ctx.textBaseline = 'alphabetic';
        ctx.save();
        ctx.translate((x + jitter.dx) * k, (page.height - y - jitter.dy) * k);
        ctx.rotate(-jitter.angle * Math.PI / 180);
        ctx.fillText(`Dear ${previewName},`, 0, 0);
        ctx.restore();
        if (!cancelled) setPreviewSrc(canvas.toDataURL('image/jpeg', 0.85));
      } catch (err) {
        console.error(err);
        if (!cancelled) setError('Failed to render the letter preview.');
      } finally {
        if (!cancelled) setPreviewLoading(false);
      }
    };
    render();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [letter, position, fontKey, fontSize, previewName, previewRecipientIndex, pageSizeKey, varyGreeting, jitterSeed]);

  // Clicking the preview moves the start of the greeting to that spot
  const handlePreviewClick = (e) => {
    const img = imgRef.current;
    if (!img || !box) return;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width * page.width;
    const yFromTop = (e.clientY - rect.top) / rect.height * page.height;
    const imageTop = page.height - box.y - box.height;
    setPosition({ fx: (x - box.x) / box.width, fy: (yFromTop - imageTop) / box.height });
  };

  const handleGenerate = async () => {
    if (!letter || recipients.length === 0) return;
    setGenerating(true);
    setError('');
    try {
      const fontBytes = await getFontBytes(fontKey);
      setProgress('Preparing letter image...');
      const doc = await PDFDocument.create();
      doc.registerFontkit(fontkit);
      const font = await doc.embedFont(fontBytes, { subset: true });
      // Embedded once and reused on every page, at full resolution
      const image = letter.type === 'png' ? await doc.embedPng(letter.bytes) : await doc.embedJpg(letter.bytes);
      const { x, y } = greetingPoint();
      for (let i = 0; i < recipients.length; i++) {
        setProgress(`Adding letter ${i + 1} of ${recipients.length}...`);
        const pdfPage = doc.addPage([page.width, page.height]);
        pdfPage.drawImage(image, box);
        const jitter = jitterFor(i);
        pdfPage.drawText(`Dear ${recipients[i].firstName},`, {
          x: x + jitter.dx,
          y: y + jitter.dy,
          rotate: degrees(jitter.angle),
          size: fontSize,
          font,
          color: rgb(0.08, 0.08, 0.12),
        });
      }
      setProgress('Saving PDF...');
      const blob = new Blob([await doc.save()], { type: 'application/pdf' });
      const now = new Date();
      const timestamp = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}_${String(now.getHours()).padStart(2,'0')}-${String(now.getMinutes()).padStart(2,'0')}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Personalized_Letters_${timestamp}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setProgress(`Downloaded ${recipients.length} personalized letters in one PDF.`);
    } catch (err) {
      console.error(err);
      setError('Something went wrong while creating the letters.');
      setProgress('');
    } finally {
      setGenerating(false);
    }
  };

  // Nudge by 3 points on the printed page
  const nudge = (dx, dy) => setPosition(p => ({ fx: p.fx + dx / box.width, fy: p.fy - dy / box.height }));

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="p-4 md:p-6 border-b border-gray-100 bg-gray-50/50">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Mail className="w-5 h-5 text-rose-500" />
          Personalized Letters
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Upload this month's letter image and get one page per subscriber with a handwritten "Dear [first name]," above the text.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 p-4 md:p-6">
        <div className="lg:col-span-1 space-y-5">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Letter Image (PNG or JPG)</label>
            <label className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-rose-400 rounded-lg p-3 cursor-pointer transition-all">
              <FileUp className="w-5 h-5" />
              <span className="text-sm font-medium truncate">{letterName || 'Browse letter image'}</span>
              <input type="file" accept="image/png,image/jpeg,.png,.jpg,.jpeg" className="hidden" onChange={handleLetterUpload} />
            </label>
            {letter && (
              <p className="text-xs text-gray-400 mt-1">
                {letter.width} × {letter.height} px
                {pageSizeKey !== 'image' && ` (${Math.round(Math.min(letter.width / (box.width / 72), letter.height / (box.height / 72)))} DPI when printed)`}
              </p>
            )}
            <p className="text-xs text-gray-400 mt-1">
              Names come from the subscriber CSV imported above ({recipients.length} subscriber{recipients.length === 1 ? '' : 's'}
              {skipped > 0 ? `, ${skipped} skipped with no name` : ''}).
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Paper Size</label>
            <select
              value={pageSizeKey}
              onChange={(e) => setPageSizeKey(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-rose-400"
            >
              {Object.entries(PAGE_SIZES).map(([key, size]) => (
                <option key={key} value={key}>{size.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Handwriting Style</label>
            <select
              value={fontKey}
              onChange={(e) => setFontKey(e.target.value)}
              className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-rose-400"
            >
              {Object.entries(HANDWRITING_FONTS).map(([key, f]) => (
                <option key={key} value={key}>{f.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Greeting Size: {fontSize}pt</label>
            <input
              type="range" min="12" max="48" value={fontSize}
              onChange={(e) => setFontSize(Number(e.target.value))}
              className="w-full accent-rose-500"
            />
          </div>

          {position && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Position</label>
              <div className="flex items-center gap-2">
                <div className="grid grid-cols-3 gap-1 w-28">
                  <span />
                  <button onClick={() => nudge(0, 3)} className="border border-gray-300 rounded py-1 text-sm hover:bg-gray-50" title="Move up">↑</button>
                  <span />
                  <button onClick={() => nudge(-3, 0)} className="border border-gray-300 rounded py-1 text-sm hover:bg-gray-50" title="Move left">←</button>
                  <button
                    onClick={() => { setPosition(getDefaultPosition(letter)); setFontSize(24); }}
                    className="border border-gray-300 rounded py-1 flex justify-center hover:bg-gray-50" title="Reset position"
                  >
                    <RotateCcw className="w-4 h-4" />
                  </button>
                  <button onClick={() => nudge(3, 0)} className="border border-gray-300 rounded py-1 text-sm hover:bg-gray-50" title="Move right">→</button>
                  <span />
                  <button onClick={() => nudge(0, -3)} className="border border-gray-300 rounded py-1 text-sm hover:bg-gray-50" title="Move down">↓</button>
                  <span />
                </div>
                <p className="text-xs text-gray-400 flex-1 flex gap-1">
                  <MousePointerClick className="w-4 h-4 flex-shrink-0" />
                  Or click on the preview where the greeting should start.
                </p>
              </div>
            </div>
          )}

          {position && (
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-gray-700">
                <input
                  type="checkbox"
                  checked={varyGreeting}
                  onChange={(e) => setVaryGreeting(e.target.checked)}
                  className="accent-rose-500 w-4 h-4"
                />
                Natural variation
              </label>
              <p className="text-xs text-gray-400 mt-1">
                Each name gets a slight random tilt (up to {MAX_TILT_DEGREES}°) and shift so no two look identical. It changes every time you upload a letter.
              </p>
              {varyGreeting && (
                <button
                  onClick={() => setJitterSeed(newSeed())}
                  className="mt-2 text-xs font-medium text-rose-600 hover:text-rose-700 flex items-center gap-1"
                >
                  <Shuffle className="w-3.5 h-3.5" />
                  Shuffle variations
                </button>
              )}
            </div>
          )}

          {recipients.length > 1 && letter && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Preview For</label>
              <select
                value={Math.min(previewIndex, recipients.length - 1)}
                onChange={(e) => setPreviewIndex(Number(e.target.value))}
                className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-rose-400"
              >
                {recipients.map((r, idx) => (
                  <option key={idx} value={idx}>{r.fullName || r.firstName}</option>
                ))}
              </select>
            </div>
          )}

          {error && <p className="text-sm text-red-600">{error}</p>}

          <button
            onClick={handleGenerate}
            disabled={!letter || recipients.length === 0 || generating}
            className="w-full bg-rose-500 hover:bg-rose-600 text-white font-bold py-3 rounded-lg transition-colors flex justify-center items-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {generating ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />}
            Download {recipients.length || ''} Letters (single PDF)
          </button>
          {recipients.length === 0 && (
            <p className="text-xs text-gray-400 -mt-3">Import your subscriber CSV above first.</p>
          )}
          {progress && <p className="text-sm text-gray-600 -mt-2">{progress}</p>}
        </div>

        <div className="lg:col-span-2">
          <div className="bg-gray-200 rounded-xl min-h-[400px] p-4 flex items-center justify-center relative">
            {!letter ? (
              <div className="text-center text-gray-500">
                <Mail className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <p className="text-lg font-medium">No letter uploaded</p>
                <p className="text-sm mt-1">Upload your letter image to preview the greeting here.</p>
              </div>
            ) : previewSrc ? (
              <>
                <img
                  ref={imgRef}
                  src={previewSrc}
                  alt="Personalized letter preview"
                  onClick={handlePreviewClick}
                  className="max-w-full h-auto shadow-md bg-white border border-gray-300 cursor-crosshair"
                />
                {previewLoading && <Loader2 className="w-6 h-6 animate-spin text-rose-500 absolute top-6 right-6" />}
              </>
            ) : (
              <Loader2 className="w-10 h-10 animate-spin text-rose-500" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
