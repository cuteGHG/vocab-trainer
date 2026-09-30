// Variablen
let allVocab = [];
let currentQuizIndex = 0;
let quizStats = { correct: 0, wrong: 0, total: 0 };
let deferredPrompt;
let currentImage = null;
let extractedVocabBuffer = [];
let appInitialized = false;
let tesseractLoadPromise = null;
let ocrInProgress = false;

// PWA Installation
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    document.getElementById('installPrompt').classList.add('show');
});

function installApp() {
    if (deferredPrompt) {
        deferredPrompt.prompt();
        deferredPrompt.userChoice.then((choiceResult) => {
            if (choiceResult.outcome === 'accepted') {
                console.log('App installiert');
            }
            deferredPrompt = null;
            document.getElementById('installPrompt').classList.remove('show');
        });
    }
}

function dismissInstall() {
    document.getElementById('installPrompt').classList.remove('show');
}

// Tab-Wechsel
function switchTab(tab) {
    document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
    document.getElementById(tab).classList.add('active');
    document.querySelector(`[onclick="switchTab('${tab}')"]`).classList.add('active');
    
    if (tab === 'library') {
        showLibrary();
    } else if (tab === 'quiz') {
        startQuiz();
    }
}

// Image Upload Handler
function initializeApp() {
    if (appInitialized) return;
    appInitialized = true;

    const uploadArea = document.getElementById('uploadArea');
    const imageInput = document.getElementById('imageInput');
    const extractBtn = document.getElementById('extractBtn');
    const uploadFileInfo = document.getElementById('uploadFileInfo');

    if (!uploadArea || !imageInput || !extractBtn || !uploadFileInfo) {
        appInitialized = false;
        return;
    }

    // Click to upload (Fallback, wichtig für Browser mit Input-Overlayschwächen)
    uploadArea.addEventListener('click', (event) => {
        if (event.target !== imageInput) {
            imageInput.click();
        }
    });

    imageInput.addEventListener('click', () => {
        imageInput.value = '';
    });

    // File input change
    imageInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        handleImageUpload(file);
    });

    // Drag and drop
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });

    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });

    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            handleImageUpload(e.dataTransfer.files[0]);
        }
    });

    extractBtn.addEventListener('click', () => {
        extractText();
    });

    // Load vocab from localStorage
    loadVocabFromStorage();
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp, { once: true });
} else {
    initializeApp();
}

function handleImageUpload(file) {
    const uploadFileInfo = document.getElementById('uploadFileInfo');
    const extractBtn = document.getElementById('extractBtn');

    if (!file) {
        if (uploadFileInfo) uploadFileInfo.textContent = 'Keine Datei ausgewählt.';
        showStatus('Bitte ein Bild auswählen.', 'error');
        return;
    }

    if (!file.type || !file.type.startsWith('image/')) {
        if (uploadFileInfo) uploadFileInfo.textContent = `Ungültige Datei: ${file.name}`;
        showStatus('Bitte ein Bild auswählen!', 'error');
        currentImage = null;
        document.getElementById('imagePreviewContainer').innerHTML = '';
        extractBtn.style.display = 'none';
        return;
    }

    if (uploadFileInfo) {
        uploadFileInfo.textContent = `Ausgewählt: ${file.name} (${Math.round(file.size / 1024)} KB)`;
    }
    showStatus('Bild wird geladen…', 'loading');

    const reader = new FileReader();
    reader.onload = (e) => {
        currentImage = e.target.result;

        // Show preview (DOM-sicher ohne inline HTML-Datenübergabe)
        const previewContainer = document.getElementById('imagePreviewContainer');
        previewContainer.innerHTML = '';
        const preview = document.createElement('div');
        preview.className = 'image-preview';
        const img = document.createElement('img');
        img.src = currentImage;
        img.alt = `Vorschau: ${file.name}`;
        preview.appendChild(img);
        previewContainer.appendChild(preview);

        document.getElementById('vocabExtracted').innerHTML = '';
        extractedVocabBuffer = [];

        // Show extract button
        extractBtn.style.display = 'block';
        extractBtn.disabled = false;
        extractBtn.textContent = '🔍 Text aus Bild erkennen';

        showStatus('Bild geladen. Texterkennung startet jetzt…', 'success');
        setTimeout(() => {
            extractText({ auto: true });
        }, 50);
    };
    reader.onerror = () => {
        currentImage = null;
        showStatus('Datei konnte nicht gelesen werden. Bitte erneut versuchen.', 'error');
        extractBtn.style.display = 'none';
    };
    reader.readAsDataURL(file);
}

function showStatus(message, type) {
    const statusDiv = document.getElementById('extractionStatus');
    statusDiv.textContent = message;
    statusDiv.className = `extraction-status ${type}`;
}

// Text extraction using Tesseract.js (OCR)
async function extractText({ auto = false } = {}) {
    if (!currentImage) {
        showStatus('Kein Bild vorhanden!', 'error');
        return;
    }

    if (ocrInProgress) {
        if (!auto) {
            showStatus('Texterkennung läuft bereits…', 'loading');
        }
        return;
    }

    const extractBtn = document.getElementById('extractBtn');
    ocrInProgress = true;
    showStatus('Erkenne Text... Das kann auf iPad etwas dauern...', 'loading');
    extractBtn.disabled = true;
    extractBtn.textContent = '⏳ Texterkennung läuft...';

    try {
        const text = await runOcr(currentImage);

        // Parse the text into vocab items
        parseVocabulary(text);
        showStatus('Text erfolgreich erkannt!', 'success');
    } catch (error) {
        console.error('OCR Error:', error);
        const offlineHint = !navigator.onLine
            ? ' Keine Internetverbindung: OCR-Bibliothek konnte nicht geladen werden.'
            : '';
        showStatus(`Fehler bei der Texterkennung.${offlineHint} Du kannst unten manuell Vokabeln eingeben.`, 'error');
        showManualInput();
    } finally {
        ocrInProgress = false;
        extractBtn.disabled = false;
        extractBtn.textContent = '🔍 Text aus Bild erkennen';
    }
}

async function runOcr(imageData) {
    const tesseract = await ensureTesseractLoaded();
    let lastError = null;

    for (const lang of ['deu+eng', 'eng']) {
        try {
            const result = await tesseract.recognize(imageData, lang);
            const text = result && result.data ? result.data.text : '';
            if (text && text.trim()) {
                return text;
            }
            return text || '';
        } catch (error) {
            lastError = error;
        }
    }

    throw lastError || new Error('OCR konnte nicht ausgeführt werden.');
}

async function ensureTesseractLoaded() {
    if (window.Tesseract && typeof window.Tesseract.recognize === 'function') {
        return window.Tesseract;
    }

    if (!tesseractLoadPromise) {
        tesseractLoadPromise = new Promise((resolve, reject) => {
            const existingScript = document.querySelector('script[data-tesseract-cdn="true"]');
            if (existingScript) {
                existingScript.addEventListener('load', () => {
                    if (window.Tesseract) {
                        resolve(window.Tesseract);
                    } else {
                        reject(new Error('Tesseract CDN geladen, aber API nicht verfügbar.'));
                    }
                }, { once: true });
                existingScript.addEventListener('error', () => reject(new Error('Tesseract Script konnte nicht geladen werden.')), { once: true });
                return;
            }

            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            script.async = true;
            script.defer = true;
            script.setAttribute('data-tesseract-cdn', 'true');
            script.onload = () => {
                if (window.Tesseract && typeof window.Tesseract.recognize === 'function') {
                    resolve(window.Tesseract);
                } else {
                    reject(new Error('Tesseract API nicht gefunden.'));
                }
            };
            script.onerror = () => reject(new Error('Tesseract CDN nicht erreichbar.'));
            document.head.appendChild(script);
        }).catch((error) => {
            tesseractLoadPromise = null;
            throw error;
        });
    }

    return tesseractLoadPromise;
}

function parseVocabulary(text) {
    const lines = text.split('\n').filter(line => line.trim());
    const vocab = [];

    // Simple parsing: Look for patterns like "word [phonetic] - definition" or "word - definition"
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        
        // Skip empty lines and lines with only numbers/brackets
        if (!line || /^[\[\]\(\)\d]+$/.test(line)) continue;

        // Try to split by common delimiters
        let word, definition, example;

        if (line.includes(' - ')) {
            [word, definition] = line.split(' - ').map(s => s.trim());
        } else if (line.includes(':')) {
            [word, definition] = line.split(':').map(s => s.trim());
        } else if (i + 1 < lines.length) {
            word = line;
            definition = lines[i + 1].trim();
        } else {
            word = line;
            definition = '';
        }

        if (word && word.length > 1) {
            vocab.push({
                id: Date.now() + Math.random(),
                word: word.toLowerCase(),
                definition: definition || 'Definition fehlt',
                example: example || '',
                createdAt: new Date().toLocaleString('de-DE')
            });
        }
    }

    if (vocab.length > 0) {
        displayExtractedVocab(vocab);
    } else {
        showManualInput();
    }
}

function displayExtractedVocab(vocab) {
    extractedVocabBuffer = Array.isArray(vocab) ? vocab.slice() : [];
    const container = document.getElementById('vocabExtracted');

    if (extractedVocabBuffer.length === 0) {
        showManualInput();
        return;
    }
    
    let html = `
        <div style="margin-top: 20px;">
            <h3 style="margin-bottom: 15px; color: #333;">Erkannte Vokabeln (${extractedVocabBuffer.length})</h3>
            <div class="vocab-list">
    `;

    extractedVocabBuffer.forEach((item, index) => {
        html += `
            <div class="vocab-item">
                <div class="vocab-item-content">
                    <div class="vocab-word">${item.word}</div>
                    <div class="vocab-definition">${item.definition}</div>
                </div>
                <button class="vocab-delete" data-extracted-index="${index}" type="button">✕</button>
            </div>
        `;
    });

    html += `
            </div>
            <button class="btn btn-success" id="saveExtractedBtn" type="button">
                ✓ Alle speichern
            </button>
        </div>
    `;

    container.innerHTML = html;

    container.querySelectorAll('[data-extracted-index]').forEach((button) => {
        button.addEventListener('click', () => {
            const index = Number(button.getAttribute('data-extracted-index'));
            if (Number.isInteger(index) && index >= 0 && index < extractedVocabBuffer.length) {
                extractedVocabBuffer.splice(index, 1);
                displayExtractedVocab(extractedVocabBuffer);
            }
        });
    });

    const saveExtractedBtn = document.getElementById('saveExtractedBtn');
    if (saveExtractedBtn) {
        saveExtractedBtn.addEventListener('click', () => saveAllVocab());
    }
}

function showManualInput() {
    const container = document.getElementById('vocabExtracted');
    container.innerHTML = `
        <div style="margin-top: 20px;">
            <h3 style="margin-bottom: 15px; color: #333;">Vokabel manuell hinzufügen</h3>
            <input type="text" id="manualWord" placeholder="Wort/Phrase" style="width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 8px;">
            <textarea id="manualDefinition" placeholder="Definition/Erklärung" style="width: 100%; padding: 10px; margin-bottom: 10px; border: 1px solid #ddd; border-radius: 8px; min-height: 80px; font-family: inherit;"></textarea>
            <button class="btn btn-primary" onclick="addManualVocab()">Hinzufügen</button>
        </div>
    `;
}

function addManualVocab() {
    const word = document.getElementById('manualWord').value.trim();
    const definition = document.getElementById('manualDefinition').value.trim();

    if (!word || !definition) {
        showStatus('Bitte Wort und Definition eingeben!', 'error');
        return;
    }

    const newVocab = {
        id: Date.now(),
        word: word.toLowerCase(),
        definition: definition,
        example: '',
        createdAt: new Date().toLocaleString('de-DE')
    };

    allVocab.push(newVocab);
    saveVocabToStorage();
    showStatus('Vokabel gespeichert!', 'success');

    document.getElementById('manualWord').value = '';
    document.getElementById('manualDefinition').value = '';

    // Clear current image
    currentImage = null;
    extractedVocabBuffer = [];
    document.getElementById('imagePreviewContainer').innerHTML = '';
    document.getElementById('vocabExtracted').innerHTML = '';
    document.getElementById('uploadFileInfo').textContent = '';
    document.getElementById('extractBtn').style.display = 'none';
}

function saveAllVocab(vocab = extractedVocabBuffer) {
    if (!Array.isArray(vocab) || vocab.length === 0) {
        showStatus('Keine Vokabeln zum Speichern vorhanden.', 'error');
        return;
    }

    allVocab.push(...vocab);
    saveVocabToStorage();
    showStatus('Alle Vokabeln gespeichert!', 'success');

    // Clear
    currentImage = null;
    extractedVocabBuffer = [];
    document.getElementById('imagePreviewContainer').innerHTML = '';
    document.getElementById('vocabExtracted').innerHTML = '';
    document.getElementById('uploadFileInfo').textContent = '';
    document.getElementById('extractBtn').style.display = 'none';
}

// LocalStorage Management
function saveVocabToStorage() {
    localStorage.setItem('vocabData', JSON.stringify(allVocab));
}

function loadVocabFromStorage() {
    const data = localStorage.getItem('vocabData');
    if (data) {
        allVocab = JSON.parse(data);
    }
}

function removeVocab(id) {
    allVocab = allVocab.filter(v => v.id !== id);
    saveVocabToStorage();
    showLibrary();
}

// Library View
function showLibrary() {
    const container = document.getElementById('libraryContent');

    if (allVocab.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">📭</div>
                <p>Noch keine Vokabeln. Upload ein Bild im "Upload"-Tab!</p>
            </div>
        `;
        return;
    }

    let html = `
        <div style="margin-bottom: 20px;">
            <h3 style="color: #333; margin-bottom: 10px;">Deine Sammlung (${allVocab.length} Vokabeln)</h3>
            <div class="vocab-list">
    `;

    allVocab.forEach(vocab => {
        html += `
            <div class="vocab-item">
                <div class="vocab-item-content">
                    <div class="vocab-word">${vocab.word}</div>
                    <div class="vocab-definition">${vocab.definition}</div>
                    <div style="font-size: 11px; color: #ccc; margin-top: 5px;">${vocab.createdAt}</div>
                </div>
                <button class="vocab-delete" onclick="removeVocab(${vocab.id})">✕</button>
            </div>
        `;
    });

    html += `
            </div>
        </div>
        <button class="btn btn-danger" onclick="clearAllVocab()" style="margin-top: 10px;">
            🗑️ Alle löschen
        </button>
    `;

    container.innerHTML = html;
}

function clearAllVocab() {
    if (confirm('Wirklich ALLE Vokabeln löschen? Das kann nicht rückgängig gemacht werden!')) {
        allVocab = [];
        saveVocabToStorage();
        showLibrary();
    }
}

// Quiz Mode
function startQuiz() {
    const container = document.getElementById('quizContent');

    if (allVocab.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <div class="empty-state-icon">🎯</div>
                <p>Noch keine Vokabeln zum Lernen. Upload zuerst ein Bild!</p>
            </div>
        `;
        return;
    }

    currentQuizIndex = 0;
    quizStats = { correct: 0, wrong: 0, total: allVocab.length };

    showQuizCard();
}

function showQuizCard() {
    const container = document.getElementById('quizContent');

    if (currentQuizIndex >= allVocab.length) {
        showQuizFinish();
        return;
    }

    const vocab = allVocab[currentQuizIndex];
    const isAskingWord = Math.random() > 0.5;

    let html = `
        <div class="quiz-stats">
            <strong>Fortschritt:</strong> ${currentQuizIndex + 1} / ${allVocab.length}
            <div class="stats-bar">
                <div class="stat">
                    <div class="stat-number">${quizStats.correct}</div>
                    <div class="stat-label">Richtig</div>
                </div>
                <div class="stat">
                    <div class="stat-number">${quizStats.wrong}</div>
                    <div class="stat-label">Falsch</div>
                </div>
            </div>
        </div>

        <div class="quiz-card">
            <div class="quiz-label">${isAskingWord ? 'Was ist die Definition?' : 'Welches Wort bedeutet:'}</div>
            <div class="quiz-content">${isAskingWord ? vocab.word : vocab.definition}</div>
            <div class="quiz-buttons">
                <button class="btn-show" onclick="showAnswer()">
                    👁️ Antwort zeigen
                </button>
            </div>
        </div>

        <div id="answerContainer" style="display: none;">
            <div class="quiz-card" style="background: linear-gradient(135deg, #51cf66 0%, #37b24d 100%);">
                <div class="quiz-label">Antwort:</div>
                <div class="quiz-content">${isAskingWord ? vocab.definition : vocab.word}</div>
            </div>
            <div class="quiz-buttons">
                <button class="btn-correct" onclick="markCorrect()">✓ Korrekt</button>
                <button class="btn-wrong" onclick="markWrong()">✕ Falsch</button>
            </div>
        </div>
    `;

    container.innerHTML = html;
}

function showAnswer() {
    document.getElementById('answerContainer').style.display = 'block';
}

function markCorrect() {
    quizStats.correct++;
    nextQuestion();
}

function markWrong() {
    quizStats.wrong++;
    nextQuestion();
}

function nextQuestion() {
    currentQuizIndex++;
    showQuizCard();
}

function showQuizFinish() {
    const container = document.getElementById('quizContent');
    const percentage = Math.round((quizStats.correct / quizStats.total) * 100);

    let html = `
        <div style="text-align: center; padding: 40px 20px;">
            <div style="font-size: 50px; margin-bottom: 20px;">
                ${percentage >= 80 ? '🎉' : percentage >= 60 ? '👍' : '💪'}
            </div>
            <h2 style="color: #333; margin-bottom: 20px;">Quiz fertig!</h2>
            
            <div class="quiz-stats">
                <div class="stats-bar">
                    <div class="stat">
                        <div class="stat-number">${quizStats.correct}</div>
                        <div class="stat-label">Richtig</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${quizStats.wrong}</div>
                        <div class="stat-label">Falsch</div>
                    </div>
                    <div class="stat">
                        <div class="stat-number">${percentage}%</div>
                        <div class="stat-label">Erfolg</div>
                    </div>
                </div>
            </div>

            <button class="btn btn-primary" onclick="startQuiz()" style="margin-top: 20px;">
                🔄 Nochmal üben
            </button>
            <button class="btn btn-secondary" onclick="switchTab('library')" style="margin-top: 10px;">
                📖 Zur Sammlung
            </button>
        </div>
    `;

    container.innerHTML = html;
}
