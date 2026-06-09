import React, { useState, useEffect } from 'react';
import { FileText, Download, Link as LinkIcon, Upload, Trash2, AlertCircle, CheckCircle2, FileUp, Settings, Eye, X, Loader2 } from 'lucide-react';

// Utility to load external scripts dynamically
const loadScript = (src) => {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = reject;
    document.head.appendChild(script);
  });
};

const stateMap = {
  'alabama': 'AL', 'alaska': 'AK', 'arizona': 'AZ', 'arkansas': 'AR', 'california': 'CA',
  'colorado': 'CO', 'connecticut': 'CT', 'delaware': 'DE', 'florida': 'FL', 'georgia': 'GA',
  'hawaii': 'HI', 'idaho': 'ID', 'illinois': 'IL', 'indiana': 'IN', 'iowa': 'IA',
  'kansas': 'KS', 'kentucky': 'KY', 'louisiana': 'LA', 'maine': 'ME', 'maryland': 'MD',
  'massachusetts': 'MA', 'michigan': 'MI', 'minnesota': 'MN', 'mississippi': 'MS', 'missouri': 'MO',
  'montana': 'MT', 'nebraska': 'NE', 'nevada': 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', 'ohio': 'OH',
  'oklahoma': 'OK', 'oregon': 'OR', 'pennsylvania': 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', 'tennessee': 'TN', 'texas': 'TX', 'utah': 'UT', 'vermont': 'VT',
  'virginia': 'VA', 'washington': 'WA', 'west virginia': 'WV', 'wisconsin': 'WI', 'wyoming': 'WY',
  'district of columbia': 'DC', 'puerto rico': 'PR',
  'alberta': 'AB', 'british columbia': 'BC', 'manitoba': 'MB', 'new brunswick': 'NB',
  'newfoundland and labrador': 'NL', 'nova scotia': 'NS', 'ontario': 'ON', 'prince edward island': 'PE',
  'quebec': 'QC', 'saskatchewan': 'SK', 'northwest territories': 'NT', 'nunavut': 'NU', 'yukon': 'YT'
};

const getShortProvince = (prov) => {
  if (!prov) return '';
  const lower = prov.trim().toLowerCase();
  if (stateMap[lower]) return stateMap[lower];
  return prov.trim().toUpperCase();
};

const toTitleCase = (str) => {
  if (!str) return '';
  return str.toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
};

const formatAddressStr = (str, preserveState = false) => {
  if (!str) return '';
  
  let formatted = str.toLowerCase().replace(/\b\w/g, s => s.toUpperCase());
  
  const abbreviations = {
    'court': 'Ct',
    'street': 'St',
    'avenue': 'Ave',
    'boulevard': 'Blvd',
    'drive': 'Dr',
    'road': 'Rd',
    'lane': 'Ln'
  };

  Object.entries(abbreviations).forEach(([word, abbr]) => {
    formatted = formatted.replace(new RegExp(`\\b${word}\\b`, 'gi'), abbr);
  });

  if (preserveState) {
    const words = formatted.split(' ');
    formatted = words.map((word, index) => {
      const cleanWord = word.replace(/[^a-zA-Z]/g, '');
      
      // If it's a 2-letter word that matches a state code (like CT, CA, NY)
      if (cleanWord.length === 2 && Object.values(stateMap).includes(cleanWord.toUpperCase())) {
        const nextWord = words[index + 1];
        const prevWord = index > 0 ? words[index - 1] : null;
        
        // Context-aware checks to ensure it's actually a State and not an address abbreviation like 'Ct' (Court)
        const isFollowedByZip = nextWord && /^\d{5}(?:-\d{4})?$/.test(nextWord.replace(/[^0-9-]/g, ''));
        const isPrecededByComma = prevWord && prevWord.endsWith(',');
        const isStandAlone = words.length <= 2;
        const isLast = index === words.length - 1;
        const startsWithNumber = /^\d/.test(words[0]);
        
        if (isFollowedByZip || isPrecededByComma || isStandAlone || (isLast && !startsWithNumber)) {
          return word.toUpperCase();
        }
      }
      return word;
    }).join(' ');
  }
  
  return formatted;
};

export default function App() {
  const [scriptsLoaded, setScriptsLoaded] = useState(false);
  const [url, setUrl] = useState('https://docs.google.com/spreadsheets/d/18TqnvZDTxSILCh2GijsZPKs0zczKhRvi1s5YmFE9Reo/edit?gid=0#gid=0');
  const [addresses, setAddresses] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // PDF Settings
  const [pageSize, setPageSize] = useState('letter');
  const [align, setAlign] = useState('center');
  const [fonts, setFonts] = useState({ pinyon: null, alice: null });

  // Preview State
  const [showPreview, setShowPreview] = useState(false);
  const [previewImages, setPreviewImages] = useState([]);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);

  // Load PapaParse, jsPDF, and Fonts on mount
  useEffect(() => {
    const fetchFontAsBase64 = async (url) => {
      const res = await fetch(url);
      const blob = await res.blob();
      return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result.split(',')[1]);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    };

    const initScripts = async () => {
      try {
        await Promise.all([
          loadScript('https://cdnjs.cloudflare.com/ajax/libs/PapaParse/5.4.1/papaparse.min.js'),
          loadScript('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js')
        ]);
        
        const [pinyonB64, aliceB64] = await Promise.all([
          fetchFontAsBase64('https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/pinyonscript/PinyonScript-Regular.ttf'),
          fetchFontAsBase64('https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/alice/Alice-Regular.ttf')
        ]);

        setFonts({ pinyon: pinyonB64, alice: aliceB64 });
        setScriptsLoaded(true);
      } catch (err) {
        setError('Failed to load required libraries or fonts. Please check your internet connection.');
      }
    };
    initScripts();
  }, []);

  const extractSheetDetails = (sheetUrl) => {
    const idMatch = sheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/);
    const gidMatch = sheetUrl.match(/[?&]gid=([0-9]+)/);
    
    if (!idMatch) return null;
    return {
      id: idMatch[1],
      gid: gidMatch ? gidMatch[1] : '0'
    };
  };

  const processCSVData = (csvText) => {
    // Treat the data as a raw 2D array to prevent "missing header" bugs
    window.Papa.parse(csvText, {
      header: false,
      skipEmptyLines: true,
      complete: (results) => {
        const data = results.data;
        if (!data || data.length === 0) {
          setError('No valid data found in the spreadsheet.');
          setLoading(false);
          return;
        }

        // 1. Smartly detect the true Header Row
        let bestHeaderRowIdx = -1;
        let maxScore = 0;
        const expectedKeywords = ['shipping', 'name', 'first', 'last', 'address', 'street', 'city', 'province', 'state', 'zip', 'postal', 'product', 'item', 'apartment', 'main'];

        for (let i = 0; i < Math.min(5, data.length); i++) {
          const rowStr = data[i].join(' ').toLowerCase();
          let score = 0;
          expectedKeywords.forEach(kw => {
            if (rowStr.includes(kw)) score++;
          });
          if (score > maxScore) {
            maxScore = score;
            bestHeaderRowIdx = i;
          }
        }

        let extractedAddresses = [];

        // 2. If we confidently found headers, map the data directly
        if (maxScore >= 2) {
          const headerRow = data[bestHeaderRowIdx].map(h => String(h).toLowerCase().replace(/[^a-z0-9]/g, ''));
          
          for (let i = bestHeaderRowIdx + 1; i < data.length; i++) {
            const row = data[i];
            
            const getCol = (possibleNames) => {
              const idx = headerRow.findIndex(h => possibleNames.some(pn => h === pn || (h.length >= 3 && h.includes(pn))));
              return idx !== -1 && row[idx] != null ? String(row[idx]).trim() : '';
            };

            const firstName = getCol(['shippingfirstname', 'firstname', 'first']);
            const lastName = getCol(['shippinglastname', 'lastname', 'last']);
            const name = firstName || lastName ? `${firstName} ${lastName}`.trim() : getCol(['shippingname', 'name', 'fullname', 'contact']);
            
            const addr2 = getCol(['apartment', 'shippingaddress2', 'address2', 'suite', 'apt']);
            const addr1 = getCol(['main', 'shippingaddress1', 'shippingaddress', 'address1', 'address', 'street']);
            const city = getCol(['shippingcity', 'city']);
            const prov = getCol(['stateshortform', 'shippingprovince', 'shippingstate', 'province', 'state']);
            const zip = getCol(['shippingzip', 'shippingzipcode', 'shippingpostalcode', 'zipcode', 'postalcode', 'zip', 'postal']);
            const product = getCol(['product', 'item', 'lineitem', 'variant', 'title']);
            const colA = row[0] != null ? String(row[0]).trim() : '';
            
            if (name || addr1 || city || zip) {
              extractedAddresses.push({ name, addr1, addr2, city, prov, zip, product, colA, isStructured: true });
            }
          }
        } else {
          // Fallback: No headers detected, try to read the raw blocks
          extractedAddresses = data.map(row => {
             let rawStr = String(row[3] || row[1] || row[0] || '').trim();
             const colA = row[0] != null ? String(row[0]).trim() : '';
             if (!rawStr) return null;
             return { raw: rawStr, colA, isStructured: false };
          }).filter(Boolean);
        }

        if (extractedAddresses.length === 0) {
          setError('No valid addresses found. Ensure your sheet has standard shipping columns.');
        } else {
          setAddresses(extractedAddresses);
          setSuccess(`Successfully imported ${extractedAddresses.length} addresses!`);
        }
        setLoading(false);
      },
      error: (err) => {
        setError('Failed to parse the spreadsheet data.');
        setLoading(false);
      }
    });
  };

  const handleFetchUrl = async () => {
    setError('');
    setSuccess('');
    setLoading(true);

    const details = extractSheetDetails(url);
    if (!details) {
      setError('Invalid Google Sheets URL. Please ensure it contains "/d/[sheet-id]".');
      setLoading(false);
      return;
    }

    const exportUrl = `https://docs.google.com/spreadsheets/d/${details.id}/gviz/tq?tqx=out:csv&gid=${details.gid}`;

    try {
      const response = await fetch(exportUrl);
      if (!response.ok) throw new Error('Network response was not ok');
      const csvText = await response.text();
      
      if (csvText.trim().toLowerCase().startsWith('<!doctype html>')) {
         throw new Error('Unauthorized');
      }
      
      processCSVData(csvText);
    } catch (err) {
      setError('Could not access the spreadsheet. Please ensure "General access" is set to "Anyone with the link". Alternatively, download it as a CSV and upload it below.');
      setLoading(false);
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    
    setError('');
    setSuccess('');
    setLoading(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      processCSVData(event.target.result);
    };
    reader.onerror = () => {
      setError('Failed to read the uploaded file.');
      setLoading(false);
    };
    reader.readAsText(file);
  };

  const removeAddress = (index) => {
    const newAddresses = [...addresses];
    newAddresses.splice(index, 1);
    setAddresses(newAddresses);
  };

  const buildPDF = () => {
    if (!scriptsLoaded || !window.jspdf) {
      setError('PDF library is still loading, please wait a moment.');
      return null;
    }
    
    try {
      const { jsPDF } = window.jspdf;
      let format = pageSize;
      let orientation = 'portrait';
      
      if (pageSize === '4x6') {
        format = [101.6, 152.4]; 
        orientation = 'landscape';
      } else if (pageSize === '5x7') {
        format = [127, 177.8]; 
        orientation = 'portrait';
      } else if (pageSize === '5x7-landscape') {
        format = [127, 177.8]; 
        orientation = 'landscape';
      }
      
      const doc = new jsPDF({
        orientation: orientation,
        unit: 'mm',
        format: format
      });

      if (fonts.pinyon && fonts.alice) {
        doc.addFileToVFS('PinyonScript-Regular.ttf', fonts.pinyon);
        doc.addFont('PinyonScript-Regular.ttf', 'Pinyon', 'normal');
        
        doc.addFileToVFS('Alice-Regular.ttf', fonts.alice);
        doc.addFont('Alice-Regular.ttf', 'Alice', 'normal');
      }

      addresses.forEach((address, index) => {
        if (index > 0) {
          doc.addPage();
        }

        const ptToMm = 0.352778; 

        // Draw Column A value (Top Right Corner, 0.5" from edges)
        if (address.colA) {
          doc.setFont('Alice', 'normal');
          doc.setFontSize(14);
          // 0.5 inches = 12.7 mm
          doc.text(address.colA, doc.internal.pageSize.getWidth() - 12.7, 12.7, { align: 'right', baseline: 'top' });
        }

        // Draw Return Address
        let returnY = 6.35; 
        const returnX = 6.35; 

        doc.setFont('Pinyon', 'normal');
        doc.setFontSize(20);
        doc.text("Aishwarya Kapa", returnX, returnY, { align: 'left', baseline: 'top' });
        
        returnY += (20 * ptToMm) + 1.5; 
        
        doc.setFont('Alice', 'normal');
        doc.setFontSize(12);
        const returnLineHeight = 12 * ptToMm * 1.1; 
        const returnAddressLines = [
          "7052 Santa Teresa Blvd #1052",
          "San Jose CA 95139"
        ];
        
        returnAddressLines.forEach(line => {
          doc.text(line, returnX, returnY, { align: 'left', baseline: 'top' });
          returnY += returnLineHeight;
        });

        let nameLine = '';
        let restLines = [];
        let isTaylorMay = false;
        
        if (address.isStructured) {
            nameLine = address.name;
            
            // Check for the specific product to add the star
            if (address.product && address.product.toLowerCase().replace(/['\u2018\u2019]/g, "'").includes("mail club (taylor's version) - may")) {
                isTaylorMay = true;
            }

            // 1st Line (Under Name): Apartment
            if (address.addr2) restLines.push(formatAddressStr(address.addr2));
            // 2nd Line: Main Address
            if (address.addr1) restLines.push(formatAddressStr(address.addr1));
            
            // 3rd Line: City State Zip (No comma, State in CAPS)
            const city = formatAddressStr(address.city);
            const prov = getShortProvince(address.prov);
            const zip = address.zip ? address.zip.toUpperCase() : '';
            
            const lastLine = [city, prov, zip].filter(Boolean).join(' ');
            if (lastLine) restLines.push(lastLine);
        } else {
            const rawLines = address.raw.split(/\r?\n/).map(l => l.trim()).filter(l => l);
            if (rawLines.length === 0) return;
            nameLine = rawLines[0];
            restLines = rawLines.slice(1).map((l, i, arr) => formatAddressStr(l, i === arr.length - 1));
        }

        if (!nameLine && restLines.length === 0) return;

        nameLine = toTitleCase(nameLine);

        let nameSizePt = 56;
        const restSizePt = 18;
        const restHeightMm = restSizePt * ptToMm;

        const pageWidth = doc.internal.pageSize.getWidth();
        const pageHeight = doc.internal.pageSize.getHeight();
        
        let x = 10; 
        if (align === 'center') {
          x = pageWidth / 2;
        } else if (align === 'right') {
          x = pageWidth - 10;
        }

        doc.setFont('Pinyon', 'normal');
        doc.setFontSize(nameSizePt);
        while (doc.getTextWidth(nameLine) > (pageWidth - 20) && nameSizePt > 24) {
            nameSizePt -= 2;
            doc.setFontSize(nameSizePt);
        }
        const nameHeightMm = nameSizePt * ptToMm;

        const linesToDraw = [];
        
        const wrappedNameLines = doc.splitTextToSize(nameLine, pageWidth - 20);
        wrappedNameLines.forEach(text => {
            linesToDraw.push({ text, font: 'Pinyon', size: nameSizePt, height: nameHeightMm });
        });

        doc.setFont('Alice', 'normal');
        doc.setFontSize(restSizePt);
        restLines.forEach(line => {
             const wLines = doc.splitTextToSize(line, pageWidth - 20);
             wLines.forEach(text => {
                 linesToDraw.push({ text, font: 'Alice', size: restSizePt, height: restHeightMm });
             });
        });

        const lineSpacingMm = 0.8; 
        const sectionSpacingMm = 7; 
        
        let totalHeight = 0;
        linesToDraw.forEach((line, idx) => {
            totalHeight += line.height;
            if (idx < linesToDraw.length - 1) {
                const nextLine = linesToDraw[idx+1];
                if (line.font === 'Pinyon' && nextLine.font === 'Alice') {
                    totalHeight += sectionSpacingMm;
                } else {
                    totalHeight += lineSpacingMm;
                }
            }
        });

        const verticalShiftMm = 6.35;
        let currentY = (pageHeight / 2) - (totalHeight / 2) + verticalShiftMm;

        // Draw Star independently above the text block so the address never moves
        if (isTaylorMay) {
            const points = 5;
            const outerRadius = 2.54; // 0.1 inch (total height ~0.2 inch)
            const innerRadius = 1.0;
            
            let cx = x;
            if (align === 'left') cx = x + outerRadius;
            if (align === 'right') cx = x - outerRadius;
            
            const starCenterY = currentY - outerRadius - 2; // 2mm gap above the top of the text block
            
            let startX, startY;
            let pathLines = [];
            
            for (let i = 0; i < points * 2; i++) {
                const radius = i % 2 === 0 ? outerRadius : innerRadius;
                const angle = (i * Math.PI) / points - Math.PI / 2;
                const px = radius * Math.cos(angle);
                const py = radius * Math.sin(angle);
                
                if (i === 0) {
                    startX = cx + px;
                    startY = starCenterY + py;
                } else {
                    const prevRadius = (i - 1) % 2 === 0 ? outerRadius : innerRadius;
                    const prevAngle = ((i - 1) * Math.PI) / points - Math.PI / 2;
                    const prevPx = prevRadius * Math.cos(prevAngle);
                    const prevPy = prevRadius * Math.sin(prevAngle);
                    pathLines.push([px - prevPx, py - prevPy]);
                }
            }
            
            doc.setFillColor(0, 0, 0); // Black Star
            doc.lines(pathLines, startX, startY, [1, 1], 'F', true);
        }

        linesToDraw.forEach((line, idx) => {
            const yCenter = currentY + (line.height / 2);
            doc.setFont(line.font, 'normal');
            doc.setFontSize(line.size);
            doc.text(line.text, x, yCenter, { 
              align: align, 
              baseline: 'middle' 
            });
            
            currentY += line.height;
            if (idx < linesToDraw.length - 1) {
                const nextLine = linesToDraw[idx+1];
                if (line.font === 'Pinyon' && nextLine.font === 'Alice') {
                    currentY += sectionSpacingMm;
                } else {
                    currentY += lineSpacingMm;
                }
            }
        });
      });

      return doc;
    } catch (err) {
      console.error(err);
      setError('An error occurred while generating the PDF.');
      return null;
    }
  };

  const handlePreview = async () => {
    setIsPreviewLoading(true);
    setShowPreview(true);
    setPreviewImages([]);

    try {
      const doc = buildPDF();
      if (!doc) throw new Error("PDF generation failed");

      if (!window.pdfjsLib) {
        await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
        window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      }

      const pdfData = doc.output('arraybuffer');
      const pdf = await window.pdfjsLib.getDocument({ data: pdfData }).promise;
      
      const numPages = pdf.numPages;
      const maxPages = Math.min(numPages, 10); 
      const images = [];

      for (let i = 1; i <= maxPages; i++) {
        const page = await pdf.getPage(i);
        const viewport = page.getViewport({ scale: 1.5 });
        
        const canvas = document.createElement('canvas');
        const context = canvas.getContext('2d');
        canvas.height = viewport.height;
        canvas.width = viewport.width;

        await page.render({ canvasContext: context, viewport: viewport }).promise;
        images.push(canvas.toDataURL('image/jpeg', 0.8));
      }

      setPreviewImages(images);
    } catch (err) {
      console.error(err);
      setError('Failed to generate PDF preview.');
      setShowPreview(false);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const generatePDF = () => {
    const doc = buildPDF();
    if (doc) {
      doc.save('Customer_Addresses.pdf');
      setSuccess('PDF generated and downloaded successfully!');
    }
  };

  if (!scriptsLoaded) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-lg font-medium text-gray-600 animate-pulse">Loading core libraries and custom fonts...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-6 md:p-10 font-sans text-gray-800">
      <div className="max-w-5xl mx-auto space-y-8">
        
        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-900 tracking-tight">Address PDF Generator</h1>
          <p className="text-gray-500">Import your Google Sheet and create a 1-address-per-page PDF instantly.</p>
        </div>

        {error && (
          <div className="bg-red-50 border border-red-200 text-red-700 p-4 rounded-xl flex items-start gap-3 shadow-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm">{error}</p>
          </div>
        )}
        {success && (
          <div className="bg-green-50 border border-green-200 text-green-700 p-4 rounded-xl flex items-start gap-3 shadow-sm">
            <CheckCircle2 className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <p className="text-sm">{success}</p>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          
          <div className="lg:col-span-1 space-y-6">
            
            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <LinkIcon className="w-5 h-5 text-blue-500" />
                Import Data
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Google Sheet URL</label>
                  <input 
                    type="text" 
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none transition-all"
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                  />
                  <p className="text-xs text-gray-400 mt-1">Sheet must be set to "Anyone with the link can view".</p>
                </div>
                
                <button 
                  onClick={handleFetchUrl}
                  disabled={loading}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-2.5 rounded-lg transition-colors flex justify-center items-center gap-2 disabled:opacity-50"
                >
                  {loading ? 'Importing...' : 'Fetch Addresses'}
                </button>

                <div className="relative py-2">
                  <div className="absolute inset-0 flex items-center">
                    <div className="w-full border-t border-gray-200"></div>
                  </div>
                  <div className="relative flex justify-center text-sm">
                    <span className="px-2 bg-white text-gray-500">OR</span>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Upload CSV Backup</label>
                  <label className="w-full flex items-center justify-center gap-2 border-2 border-dashed border-gray-300 text-gray-600 hover:bg-gray-50 hover:border-blue-400 rounded-lg p-3 cursor-pointer transition-all">
                    <FileUp className="w-5 h-5" />
                    <span className="text-sm font-medium">Browse CSV file</span>
                    <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
                  </label>
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
              <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Settings className="w-5 h-5 text-purple-500" />
                PDF Settings
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Page Size</label>
                  <select 
                    value={pageSize}
                    onChange={(e) => setPageSize(e.target.value)}
                    className="w-full border border-gray-300 rounded-lg p-2 text-sm outline-none focus:ring-2 focus:ring-purple-500"
                  >
                    <option value="letter">Letter (8.5" x 11")</option>
                    <option value="a4">A4 (210 × 297 mm)</option>
                    <option value="4x6">4x6 Label (Landscape)</option>
                    <option value="5x7">5x7 Card (Portrait)</option>
                    <option value="5x7-landscape">5x7 Card (Landscape)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Text Alignment</label>
                  <div className="flex bg-gray-100 rounded-lg p-1">
                    <button 
                      onClick={() => setAlign('left')}
                      className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${align === 'left' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Left
                    </button>
                    <button 
                      onClick={() => setAlign('center')}
                      className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${align === 'center' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Center
                    </button>
                    <button 
                      onClick={() => setAlign('right')}
                      className={`flex-1 text-sm py-1.5 rounded-md transition-colors ${align === 'right' ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                      Right
                    </button>
                  </div>
                </div>
              </div>
            </div>

            <div className="bg-gradient-to-br from-blue-600 to-purple-600 p-6 rounded-2xl shadow-md text-white">
              <h2 className="text-lg font-semibold mb-2">Ready to Print?</h2>
              <p className="text-blue-100 text-sm mb-5">
                {addresses.length > 0 
                  ? `You have ${addresses.length} addresses ready to be exported.`
                  : 'Import some addresses first to generate your PDF.'}
              </p>
              
              <div className="flex flex-col gap-3">
                <button 
                  onClick={handlePreview}
                  disabled={addresses.length === 0}
                  className="w-full bg-blue-500/30 hover:bg-blue-500/50 text-white font-bold py-3 rounded-lg transition-colors flex justify-center items-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed border border-blue-400/50"
                >
                  <Eye className="w-5 h-5" />
                  Preview PDF
                </button>
                <button 
                  onClick={generatePDF}
                  disabled={addresses.length === 0}
                  className="w-full bg-white text-blue-700 hover:bg-gray-50 font-bold py-3 rounded-lg transition-colors flex justify-center items-center gap-2 shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Download className="w-5 h-5" />
                  Download PDF
                </button>
              </div>
            </div>

          </div>

          <div className="lg:col-span-2">
            <div className="bg-white rounded-2xl shadow-sm border border-gray-100 h-full flex flex-col overflow-hidden">
              <div className="p-4 md:p-6 border-b border-gray-100 flex justify-between items-center bg-gray-50/50">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <FileText className="w-5 h-5 text-gray-500" />
                  Address Preview
                </h2>
              </div>
              
              <div className="flex-1 overflow-auto p-0">
                {addresses.length === 0 ? (
                  <div className="h-full min-h-[400px] flex flex-col items-center justify-center text-gray-400 p-8 text-center">
                    <FileText className="w-16 h-16 mb-4 opacity-20" />
                    <p className="text-lg font-medium text-gray-500">No addresses loaded</p>
                    <p className="text-sm mt-1">Fetch from the URL or upload a CSV to see the preview here.</p>
                  </div>
                ) : (
                  <ul className="divide-y divide-gray-100">
                    {addresses.map((addr, index) => {
                      let displayLines = '';
                      const isTaylorMay = addr.product && addr.product.toLowerCase().replace(/['\u2018\u2019]/g, "'").includes("mail club (taylor's version) - may");
                      const prefix = isTaylorMay ? "★ " : "";

                      if (addr.isStructured) {
                        const city = formatAddressStr(addr.city);
                        const prov = getShortProvince(addr.prov);
                        const zip = (addr.zip || '').toUpperCase();
                        const lastLine = [city, prov, zip].filter(Boolean).join(' ');

                        displayLines = [
                          prefix + toTitleCase(addr.name),
                          formatAddressStr(addr.addr2), // Apartment
                          formatAddressStr(addr.addr1), // Main Address
                          lastLine                      // City State Zip
                        ].filter(Boolean).join('\n');
                      } else {
                        const rawLines = addr.raw.split(/\r?\n/).map(l => l.trim()).filter(l => l);
                        if (rawLines.length > 0) {
                          displayLines = [
                            prefix + toTitleCase(rawLines[0]),
                            ...rawLines.slice(1).map((l, i, arr) => formatAddressStr(l, i === arr.length - 1))
                          ].join('\n');
                        }
                      }

                      return (
                        <li key={index} className="flex items-center hover:bg-gray-50 transition-colors group">
                          <div className="flex-shrink-0 w-12 text-center text-xs font-medium text-gray-400 py-4">
                            {index + 1}
                          </div>
                          <div className="flex-1 py-4 px-2 pr-4 text-sm text-gray-800 whitespace-pre-wrap">
                            {displayLines}
                          </div>
                          <div className="pr-4 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button 
                              onClick={() => removeAddress(index)}
                              className="p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                              title="Remove this address"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </div>
          </div>

        </div>
      </div>

      {showPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4 md:p-8 backdrop-blur-sm">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-full max-h-[90vh] flex flex-col overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b border-gray-100 bg-gray-50">
              <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
                <Eye className="w-5 h-5 text-purple-600" />
                PDF Preview {previewImages.length > 0 && <span className="text-sm font-normal text-gray-500 ml-2">(Showing {previewImages.length} of {addresses.length} pages)</span>}
              </h3>
              <button
                onClick={() => {
                  setShowPreview(false);
                  setPreviewImages([]);
                }}
                className="text-gray-500 hover:text-red-600 p-2 rounded-xl hover:bg-red-50 transition-colors"
                title="Close Preview"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 bg-gray-200 p-4 md:p-8 overflow-y-auto flex flex-col items-center gap-8">
              {isPreviewLoading ? (
                <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-4 my-auto">
                  <Loader2 className="w-10 h-10 animate-spin text-purple-500" />
                  <p className="font-medium">Generating high-quality preview...</p>
                </div>
              ) : previewImages.length > 0 ? (
                previewImages.map((src, idx) => (
                  <div key={idx} className="relative flex flex-col items-center">
                    <div className="absolute -left-16 md:-left-24 top-4 text-xs md:text-sm font-medium text-gray-500">Page {idx + 1}</div>
                    <img src={src} alt={`PDF Page ${idx + 1}`} className="max-w-full h-auto shadow-md bg-white border border-gray-300" />
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-gray-500 my-auto">
                  <AlertCircle className="w-10 h-10 mb-2 text-red-400" />
                  <p>Failed to load preview.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
