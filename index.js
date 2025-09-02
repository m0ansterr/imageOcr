const express = require('express');
const multer = require('multer');
const axios = require('axios');
const sharp = require('sharp');
const Tesseract = require('tesseract.js');
const { resolve } = require('path');

const app = express();
const port = 3010;

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept images only
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

// Serve static files
app.use(express.static('static'));

// Helper function to perform OCR on image buffer
async function performOCR(imageBuffer) {
  try {
    // Convert image to PNG using Sharp for better OCR compatibility
    const pngBuffer = await sharp(imageBuffer)
      .png()
      .toBuffer();
    
    // Perform OCR using Tesseract
    const result = await Tesseract.recognize(pngBuffer, 'eng', {
      logger: m => console.log(m) // Optional: log progress
    });
    
    return result.data.text.trim();
  } catch (error) {
    throw new Error(`OCR processing failed: ${error.message}`);
  }
}

// Helper function to download image from URL
async function downloadImage(url) {
  try {
    const response = await axios.get(url, {
      responseType: 'arraybuffer',
      timeout: 30000, // 30 second timeout
      maxContentLength: 10 * 1024 * 1024, // 10MB limit
    });
    
    return Buffer.from(response.data);
  } catch (error) {
    if (error.code === 'ENOTFOUND') {
      throw new Error('Invalid URL or network error');
    } else if (error.response && error.response.status === 404) {
      throw new Error('Image not found at the provided URL');
    } else if (error.code === 'ECONNABORTED') {
      throw new Error('Request timeout - image download took too long');
    } else {
      throw new Error(`Failed to download image: ${error.message}`);
    }
  }
}

// Route 1: OCR from URL (GET /?url=...)
app.get('/', async (req, res) => {
  const { url } = req.query;
  
  // If no URL provided, serve the HTML page
  if (!url) {
    return res.sendFile(resolve(__dirname, 'pages/index.html'));
  }
  
  try {
    // Validate URL format
    try {
      new URL(url);
    } catch {
      return res.status(400).json({
        error: 'Invalid URL format'
      });
    }
    
    console.log(`Processing image from URL: ${url}`);
    
    // Download image from URL
    const imageBuffer = await downloadImage(url);
    
    // Perform OCR
    const extractedText = await performOCR(imageBuffer);
    
    // Return extracted text
    res.json({
      text: extractedText,
      source: 'url',
      url: url
    });
    
  } catch (error) {
    console.error('OCR Error (URL):', error.message);
    res.status(500).json({
      error: error.message
    });
  }
});

// Route 2: OCR from uploaded file (POST /)
app.post('/', upload.single('image'), async (req, res) => {
  try {
    // Check if file was uploaded
    if (!req.file) {
      return res.status(400).json({
        error: 'No image file uploaded. Please include an image in the "image" field.'
      });
    }
    
    console.log(`Processing uploaded file: ${req.file.originalname} (${req.file.size} bytes)`);
    
    // Perform OCR on uploaded file buffer
    const extractedText = await performOCR(req.file.buffer);
    
    // Return extracted text
    res.json({
      text: extractedText,
      source: 'upload',
      filename: req.file.originalname,
      size: req.file.size
    });
    
  } catch (error) {
    console.error('OCR Error (Upload):', error.message);
    res.status(500).json({
      error: error.message
    });
  }
});

// Error handling middleware for multer
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        error: 'File too large. Maximum size is 10MB.'
      });
    }
  }
  
  if (error.message === 'Only image files are allowed!') {
    return res.status(400).json({
      error: 'Only image files are allowed. Please upload a valid image.'
    });
  }
  
  res.status(500).json({
    error: 'Internal server error'
  });
});

app.listen(port, () => {
  console.log(`OCR API server listening at http://localhost:${port}`);
  console.log('');
  console.log('Usage:');
  console.log(`  GET  /?url=<image_url>     - OCR from image URL`);
  console.log(`  POST / (with image file)   - OCR from uploaded file`);
});
