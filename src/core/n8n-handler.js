// SOAP AI Assistant - N8N API Handler
// ================================================

import { SEVERITY_LEVELS, SOAP_CATEGORIES } from './constants.js';

/**
 * Send SOAP data to N8N webhook and get AI corrections
 * @param {string} url - N8N webhook URL
 * @param {Object} soapData - SOAP data from form
 * @returns {Promise<Object>} - Corrections response
 */
export async function sendToN8N(url, soapData) {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        soap: soapData,
        timestamp: new Date().toISOString(),
        source: 'chrome-extension'
      })
    });

    if (!response.ok) {
      throw new Error(`N8N responded with status: ${response.status}`);
    }

    // Cek apakah response body kosong
    const text = await response.text();
    if (!text || text.trim() === '') {
      console.warn('SOAP Assistant - N8N returned empty response');
      return getEmptyCorrections();
    }

    // Parse JSON
    const result = JSON.parse(text);
    return formatN8NResponse(result);

  } catch (error) {
    console.error('SOAP Assistant - N8N Error:', error);
    return getEmptyCorrections();
  }
}

/**
 * Format N8N response to match expected correction structure
 * @param {Object} result - Raw N8N response
 * @returns {Object} - Formatted corrections
 */
function formatN8NResponse(result) {
  // Handle new format from n8n webhook:
  // {
  //   hasil_analisis: [
  //     { lokasi_field, kategori, masalah, rekomendasi_perbaikan }
  //   ],
  //   ringkasan_kategori: { S: 1, O: 1, A: 0, P: 0 }
  // }

  if (result.hasil_analisis && Array.isArray(result.hasil_analisis)) {
    const corrections = { S: [], O: [], A: [], P: [] };

    result.hasil_analisis.forEach(item => {
      const category = item.kategori || item.lokasi_field?.substring(0, 1).toUpperCase();
      if (corrections[category]) {
        corrections[category].push({
          message: item.masalah || 'Issue found',
          severity: SEVERITY_LEVELS.WARNING,
          suggestion: item.rekomendasi_perbaiki || item.rekomendasi_perbaikan || '',
          original: item.original || ''
        });
      }
    });

    return corrections;
  }

  // Expected format from N8N:
  // {
  //   corrections: {
  //     S: [{ message, severity, suggestion, original }],
  //     O: [...],
  //     A: [...],
  //     P: [...]
  //   }
  // }

  if (result.corrections) {
    return result.corrections;
  }

  // Alternative format handling
  return {
    S: result.S || [],
    O: result.O || [],
    A: result.A || [],
    P: result.P || []
  };
}

/**
 * Get empty corrections (when N8N returns error or empty response)
 * @returns {Object} - Empty corrections
 */
function getEmptyCorrections() {
  return {
    S: [],
    O: [],
    A: [],
    P: []
  };
}

/**
 * Get mock corrections for testing (when N8N is not configured)
 * @returns {Object} - Mock corrections
 */
function getMockCorrections() {
  return {
    S: [
      {
        message: 'Keluhan tidak spesifik',
        severity: SEVERITY_LEVELS.WARNING,
        suggestion: 'Tambahkan durasi dan intensitas nyata',
        original: 'Pasien sakit kepala'
      }
    ],
    O: [
      {
        message: 'Data vital sign tidak lengkap',
        severity: SEVERITY_LEVELS.ERROR,
        suggestion: 'Tambahkan tekanan darah, nadi, dan suhu',
        original: 'TD: -'
      },
      {
        message: 'Pemeriksaan fisik kurang detail',
        severity: SEVERITY_LEVELS.INFO,
        suggestion: 'Deskripsikan status lokal dan general'
      }
    ],
    A: [],
    P: [
      {
        message: 'Rencana tatalaksana tidak spesifik',
        severity: SEVERITY_LEVELS.WARNING,
        suggestion: 'Tuliskan dosis dan frekuensi obat'
      }
    ]
  };
}
