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
  console.log('SOAP Assistant [N8N] - Sending request to:', url);

  // Create abort controller for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minutes timeout

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
      }),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    console.log('SOAP Assistant [N8N] - Response status:', response.status);

    if (!response.ok) {
      throw new Error(`N8N responded with status: ${response.status}`);
    }

    // Cek apakah response body kosong
    const text = await response.text();
    console.log('SOAP Assistant [N8N] - Response text length:', text.length);
    console.log('SOAP Assistant [N8N] - Response preview:', text.substring(0, 200));

    if (!text || text.trim() === '') {
      console.warn('SOAP Assistant - N8N returned empty response');
      return getEmptyCorrections();
    }

    // Parse JSON
    const result = JSON.parse(text);
    console.log('SOAP Assistant [N8N] - Parsed result:', result);

    const formatted = formatN8NResponse(result);
    console.log('SOAP Assistant [N8N] - Formatted corrections:', formatted);

    return formatted;

  } catch (error) {
    clearTimeout(timeoutId);

    if (error.name === 'AbortError') {
      console.error('SOAP Assistant - N8N Request timeout after 5 minutes');
      return {
        status: 'error',
        message: 'Request timeout. N8N membutuhkan waktu terlalu lama untuk merespons (>5 menit).',
        reason: 'client_timeout',
        corrections: getEmptyCorrections()
      };
    }

    // Handle specific HTTP status errors
    const errorMessage = error.message || '';
    if (errorMessage.includes('504') || errorMessage.includes('timeout') || errorMessage.includes('Gateway')) {
      console.error('SOAP Assistant - N8N Gateway Timeout (504)');
      return {
        status: 'error',
        message: 'N8N server timeout (504). Proses analisis terlalu lama untuk server. Coba lagi atau hubungi admin.',
        reason: 'server_timeout_504',
        corrections: getEmptyCorrections()
      };
    }

    if (errorMessage.includes('503') || errorMessage.includes('unavailable')) {
      console.error('SOAP Assistant - N8N Service Unavailable (503)');
      return {
        status: 'error',
        message: 'N8N sedang sibuk atau maintenance. Coba lagi dalam beberapa saat.',
        reason: 'service_unavailable_503',
        corrections: getEmptyCorrections()
      };
    }

    console.error('SOAP Assistant - N8N Error:', error);
    return {
      status: 'error',
      message: `Gagal menghubungi N8N: ${errorMessage}`,
      reason: 'network_error',
      corrections: getEmptyCorrections()
    };
  }
}

/**
 * Format N8N response to match expected correction structure
 * @param {Object} result - Raw N8N response
 * @returns {Object} - Formatted corrections
 */
function formatN8NResponse(result) {
  // Handle array response from n8n: [{ output: {...} }]
  if (Array.isArray(result) && result.length > 0 && result[0].output) {
    result = result[0].output;
  }

  // Handle status response like no_knowledge
  // {
  //   status: "no_knowledge",
  //   message: "Sistem tidak memiliki pengetahuan assessment ini"
  // }
  if (result.status === 'no_knowledge' || result.status === 'error') {
    return {
      status: result.status,
      message: result.message || 'Terjadi kesalahan',
      reason: result.reason || '',
      corrections: getEmptyCorrections()
    };
  }

  // Handle new format from n8n webhook with hasil_analisis:
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

  // Handle format with saran_perbaikan and detail_temuan:
  // {
  //   diagnosis_utama: "...",
  //   total_kesalahan: 3,
  //   ringkasan_kategori: { S: 1, O: 0, A: 1, P: 1 },
  //   saran_perbaikan: { S: [...], O: [...], A: [...], P: [...] },
  //   detail_temuan: [{ bagian_soap, masalah_substansi, data_input, standar_clinical_pathway, saran, sumber_dari_vector_db }]
  // }

  if (result.saran_perbaikan) {
    console.log('SOAP Assistant - Processing saran_perbaikan format');
    console.log('SOAP Assistant - detail_temuan:', result.detail_temuan);
    console.log('SOAP Assistant - saran_perbaikan:', result.saran_perbaikan);

    const corrections = { S: [], O: [], A: [], P: [] };

    // Process detail_temuan to create individual correction items
    if (result.detail_temuan && Array.isArray(result.detail_temuan)) {
      result.detail_temuan.forEach(item => {
        const category = item.bagian_soap; // S, O, A, or P
        if (corrections[category]) {
          corrections[category].push({
            message: item.masalah_substansi || 'Issue found',
            severity: SEVERITY_LEVELS.WARNING,
            suggestion: item.saran || '',
            original: item.data_input || ''
          });
        }
      });
      console.log('SOAP Assistant - Corrections after detail_temuan:', corrections);
    }

    // Also include any suggestions from saran_perbaikan
    Object.keys(result.saran_perbaikan).forEach(category => {
      if (corrections[category] && Array.isArray(result.saran_perbaikan[category])) {
        result.saran_perbaikan[category].forEach(suggestion => {
          // Only add if not already added from detail_temuan
          const exists = corrections[category].some(c => c.suggestion === suggestion);
          if (!exists) {
            corrections[category].push({
              message: 'Rekomendasi perbaikan',
              severity: SEVERITY_LEVELS.INFO,
              suggestion: suggestion,
              original: ''
            });
          }
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
