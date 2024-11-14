const express = require('express'); //Framework web applications build krne ke liye
const path = require('path'); // utilities provide krta h working with file and directory paths ke liye
const mysql = require('mysql2'); // Use mysql2 package
const http = require('http'); // Built-in modules for handling HTTP and HTTPS requests
const https = require('https'); 
const url = require('url'); //URL resolution and parsing ke liye module
const app = express(); // express application ka instance
const port = process.env.PORT || 3000;

// MySQL connection
const db = mysql.createConnection({
    host: 'localhost',
    user: 'newuser',         // Use your MySQL username
    password: 'yourpassword', // Use your MySQL password
    database: 'url_shortener'
});

// Connect to the database
db.connect(err => {
    if (err) {
        console.error('MySQL connection error:', err);
        return;
    }
    console.log('MySQL connected');
});

// Middleware
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Token Bucket Rate Limiter
const rateLimit = {
    bucketSize: 5, // Number of tokens in the bucket
    refillRate: 1, // Tokens to add to the bucket per second
    currentTokens: 5,
    lastRefillTime: Date.now(),
};

function refillTokens() {
    const now = Date.now();
    const timePassed = (now - rateLimit.lastRefillTime) / 1000; // Convert milliseconds to seconds
    const tokensToAdd = Math.floor(timePassed * rateLimit.refillRate);
    rateLimit.currentTokens = Math.min(rateLimit.bucketSize, rateLimit.currentTokens + tokensToAdd);
    rateLimit.lastRefillTime = now;
}

function rateLimiter(req, res, next) {
    refillTokens();
    if (rateLimit.currentTokens > 0) {
        rateLimit.currentTokens--;
        next(); // Allow the request
    } else {
        res.status(429).send('Too Many Requests: Rate limit exceeded.'); // Rate limit exceeded
    }
}

// Endpoint to shorten URL with rate limiting
app.post('/shorten', rateLimiter, (req, res) => {
    const originalUrl = req.body.url;

    // Validate URL format
    const urlPattern = /^(https?:\/\/[^\s]+)/;
    if (!urlPattern.test(originalUrl)) {
        return res.status(400).json({ error: 'Invalid URL format.' });
    }

    const shortId = Date.now().toString(36); // Generate a short ID based on timestamp

    // Insert into the database
    const query = 'INSERT INTO urls (original_url, short_id) VALUES (?, ?)';
    db.query(query, [originalUrl, shortId], (err) => {
        if (err) {
            console.error('Error inserting URL:', err);
            return res.status(500).send('Server error');
        }
        const shortUrl = `${req.protocol}://${req.get('host')}/${shortId}`; // Shortened URL
        res.json({ shortUrl });
    });
});

// Redirect to the original URL
app.get('/:id', (req, res) => {
    const query = 'SELECT original_url FROM urls WHERE short_id = ?';
    db.query(query, [req.params.id], (err, results) => {
        if (err) {
            console.error('Database error:', err);
            return res.status(500).send('Server error');
        }
        if (results.length > 0) {
            res.redirect(results[0].original_url); // Redirect to original URL
        } else {
            res.status(404).send('Not found');
        }
    });
});

// Function to follow URL redirects
function followRedirect(currentUrl, redirectChain = []) {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(currentUrl);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        const request = protocol.get(currentUrl, (response) => {
            const { statusCode, headers } = response;

            // Check if the status code indicates a redirect
            if (statusCode >= 300 && statusCode < 400 && headers.location) {
                const newUrl = url.resolve(currentUrl, headers.location);
                redirectChain.push({ from: currentUrl, to: newUrl });
                // Recursively follow the new URL
                followRedirect(newUrl, redirectChain)
                    .then(resolve)
                    .catch(reject);
            } else {
                // Final destination reached
                redirectChain.push({ from: currentUrl, to: currentUrl });
                resolve(redirectChain);
            }
        });

        request.on('error', (err) => {
            reject(`Request error: ${err.message}`);
        });
    });
}

// Endpoint to check redirects for a given URL
app.post('/check-redirects', async (req, res) => {
    const { urlToCheck } = req.body;

    try {
        if (!urlToCheck) {
            return res.status(400).json({ error: 'URL is required' });
        }

        const redirectChain = await followRedirect(urlToCheck);
        res.json({
            message: 'Redirect chain followed successfully',
            redirectChain: redirectChain,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

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
            return true; // URL is malicious
        }
    }
    return false; // URL is not malicious
}

// Endpoint to check if a URL is malicious
app.post('/check-malicious', (req, res) => {
    const { urlToCheck } = req.body;

    if (!urlToCheck) {
        return res.status(400).json({ error: 'URL is required' });
    }

    const isMalicious = isMaliciousURL(urlToCheck);
    if (isMalicious) {
        return res.json({ message: 'The URL is potentially malicious.' });
    } else {
        return res.json({ message: 'The URL appears to be safe.' });
    }
});

// Function to fetch URL metadata information
async function fetchURLInfo(urlToFetch) {
    return new Promise((resolve, reject) => {
        const parsedUrl = url.parse(urlToFetch);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;

        const request = protocol.get(urlToFetch, (response) => {
            let data = '';

            // Collect response data
            response.on('data', chunk => {
                data += chunk;
            });

            // On end, parse metadata
            response.on('end', () => {
                const cheerio = require('cheerio');
                const $ = cheerio.load(data);
                resolve({
                    title: $('title').text(),
                    description: $('meta[name="description"]').attr('content'),
                    url: urlToFetch,
                    effectiveUrl: response.responseUrl || urlToFetch, // Updated for effective URL
                    redirections: [], // Placeholder for redirections, can be populated if needed
                    safeBrowsing: 'Unavailable' // Placeholder for safe browsing info
                });
            });
        });

        request.on('error', (err) => {
            reject(`Failed to fetch URL information: ${err.message}`);
        });
    });
}

// Endpoint to get URL metadata information
app.post('/get-url-info', async (req, res) => {
    const { url } = req.body;

    if (!url) {
        return res.status(400).json({ error: 'URL is required' });
    }

    try {
        const urlInfo = await fetchURLInfo(url);
        res.json(urlInfo);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve the index.html file
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start the server
app.listen(port, () => {
    console.log(`URL Shortener running at http://localhost:${port}`);
});
