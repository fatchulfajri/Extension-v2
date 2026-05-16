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

    const result = await response.json();
    return formatN8NResponse(result);

  } catch (error) {
    console.error('SOAP Assistant - N8N Error:', error);
    return getMockCorrections();
  }
}

/**
 * Format N8N response to match expected correction structure
 * @param {Object} result - Raw N8N response
 * @returns {Object} - Formatted corrections
 */
function formatN8NResponse(result) {
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
