// Base62 encoding
const base62 = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

// Function to encode a number to Base62
function encodeBase62(num) {
    let encoded = '';
    while (num > 0) {
        encoded = base62[num % 62] + encoded;
        num = Math.floor(num / 62);
    }
    return encoded || '0'; // Return '0' if num is 0
}

// Function to generate a simple QR code matrix with proper finder patterns
function generateQRMatrix(url) {
    const size = 29; // QR code matrix size (standard)
    const matrix = Array.from({ length: size }, () => Array(size).fill(0));

    // Helper function to draw finder patterns (7x7 squares with 1-pixel borders)
    const drawFinderPattern = (row, col) => {
        for (let r = 0; r < 7; r++) {
            for (let c = 0; c < 7; c++) {
                if (
                    r === 0 || r === 6 || c === 0 || c === 6 || // Outer square
                    (r >= 2 && r <= 4 && c >= 2 && c <= 4) // Inner square
                ) {
                    matrix[row + r][col + c] = 1; // Fill cell
                }
            }
        }
    };

    // Add finder patterns (top-left, top-right, bottom-left)
    drawFinderPattern(0, 0);              // Top-left
    drawFinderPattern(0, size - 7);       // Top-right
    drawFinderPattern(size - 7, 0);       // Bottom-left

    // Fill the rest of the QR code with binary representation of the URL
    const urlBinary = url.split('')
        .map(c => c.charCodeAt(0).toString(2).padStart(8, '0'))
        .join('');

    let binaryIndex = 0;
    for (let row = 0; row < size; row++) {
        for (let col = 0; col < size; col++) {
            // Skip cells occupied by finder patterns
            if (row < 7 && (col < 7 || col >= size - 7) || (row >= size - 7 && col < 7)) {
                continue;
            }
            // Fill matrix with binary data of URL if there's still data left
            if (binaryIndex < urlBinary.length) {
                matrix[row][col] = urlBinary[binaryIndex] === '1' ? 1 : 0;
                binaryIndex++;
            }
        }
    }

    return matrix;
}

// Function to render the QR code matrix
function renderQRCode(matrix) {
    const qrCodeDiv = document.getElementById('qr-code');
    qrCodeDiv.innerHTML = ''; // Clear previous QR code
    matrix.forEach(row => {
        row.forEach(cell => {
            const div = document.createElement('div');
            div.classList.add('qr-cell'); // Add class for styling
            if (cell === 1) {
                div.classList.add('filled'); // Fill cell if it's part of the QR code
            }
            qrCodeDiv.appendChild(div);
        });
    });
}

// Function to check for malicious URLs
function isMaliciousURL(url) {
    const maliciousPatterns = [
        /malicious\.com/i,
        /phishing\.com/i,
        /spam\.com/i,
        /^http:\/\//i // Pattern to catch all HTTP URLs
    ];
    for (const pattern of maliciousPatterns) {
        if (pattern.test(url)) {
            return "The URL is potentially malicious.";
        }
    }
    return null; // No malicious patterns found
}

// Function to shorten the URL
async function shortenURL() {
    const input = document.getElementById('url-input').value.trim();
    const formattedURL = input.startsWith('http://') ? input.replace('http://', 'https://') : input;

    // Validate URL format
    const urlPattern = /^(https?:\/\/[^\s]+)/;
    if (!urlPattern.test(formattedURL)) {
        alert("Please enter a valid URL.");
        return;
    }

    // Perform the URL shortening
    try {
        const response = await fetch('/shorten', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url: formattedURL })
        });

        if (response.ok) {
            const data = await response.json();
            const qrMatrix = generateQRMatrix(formattedURL);
            renderQRCode(qrMatrix);
            document.getElementById('shortened-url').textContent = data.shortUrl;
            document.getElementById('output').style.display = 'block';
        } else {
            const errorData = await response.json();
            alert(errorData.error);
        }
    } catch (error) {
        console.error('Error shortening URL:', error);
        alert("An error occurred while shortening the URL.");
    }
}

// Function to check if a URL is malicious
async function checkMaliciousURL() {
    const urlInput = document.getElementById('malicious-url-input').value.trim();
    const maliciousCheck = isMaliciousURL(urlInput);
    if (maliciousCheck) {
        alert(maliciousCheck);
    } else {
        alert("The URL appears to be safe.");
    }
}

// Function to check URL redirects
async function checkRedirects() {
    const redirectUrl = document.getElementById('redirect-url-input').value.trim();

    if (!redirectUrl) {
        alert("Please enter a URL.");
        return;
    }

    try {
        const response = await fetch('/check-redirects', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ urlToCheck: redirectUrl })
        });

        if (response.ok) {
            const data = await response.json();
            const redirectChain = document.getElementById('redirect-chain');
            redirectChain.innerHTML = ''; // Clear previous redirect chain

            data.redirectChain.forEach((redirect, index) => {
                const li = document.createElement('li');
                li.textContent = `${index + 1}. ${redirect.from} -> ${redirect.to}`;
                redirectChain.appendChild(li);
            });

            document.getElementById('redirect-output').style.display = 'block';
        } else {
            const errorData = await response.json();
            alert(errorData.error || "Failed to check redirects. Please try again.");
        }
    } catch (error) {
        console.error('Error fetching redirect chain:', error);
        alert("An error occurred while checking redirects.");
    }
}

// Function to get URL metadata information
async function getURLInfo() {
    const urlInput = document.getElementById('url-info-input').value.trim();

    if (!urlInput) {
        alert("Please enter a URL.");
        return;
    }

    try {
        const response = await fetch(`/get-url-info`, {  
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ url: urlInput }) // Sending URL in request body
        });

        if (response.ok) {
            const data = await response.json();

            document.getElementById('link-title').textContent = data.title || 'No title found';
            document.getElementById('link-description').textContent = data.description || 'No description found';
            document.getElementById('link-url').textContent = data.url || 'No URL found';
            document.getElementById('link-effective-url').textContent = data.effectiveUrl || 'No effective URL';
            document.getElementById('link-redirections').textContent = data.redirections || 'None';
            document.getElementById('link-safe-browsing').textContent = data.safeBrowsing || 'Unavailable';

            document.getElementById('url-info-output').style.display = 'block';
        } else {
            const errorData = await response.json();
            alert(errorData.error || "Failed to fetch URL information.");
        }
    } catch (error) {
        console.error('Error fetching URL information:', error);
        alert("An error occurred while retrieving URL information.");
    }
}
