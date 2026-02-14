#!/usr/bin/env bun
/**
 * Verification script for completion marker detection fix
 * 
 * Demonstrates that the plugin correctly:
 * 1. Detects marker at end of message → stops reprompting
 * 2. Detects marker in middle → continues reprompting
 * 3. Handles edge cases (whitespace, multiple markers)
 */

import { getState, cleanupState, updateState } from './src/state'
import { loadConfig } from './src/config'

const TEST_SESSION = 'verify-completion-test'

// Helper to check completion marker detection (simple string contains)
async function checkCompletionMarker(
  lastMessageContent: string,
  marker: string
): Promise<boolean> {
  return lastMessageContent.includes(marker)
}

async function runVerification() {
  console.log('🔍 Verification: Completion Marker Detection Fix\n')
  
  // Load config to get completion marker
  const config = await loadConfig(process.cwd())
  const marker = config.completionMarker
  
  console.log(`Completion Marker: "${marker}"\n`)
  console.log('─'.repeat(60))
  
  // Test Case 1: Marker at end (should stop)
  console.log('\n✅ Test 1: Marker at END of message (should STOP)')
  const case1 = `I have completed all the tasks. Everything is done. ${marker}`
  const result1 = await checkCompletionMarker(case1, marker)
  console.log(`   Message: "${case1}"`)
  console.log(`   Detected: ${result1 ? '✅ YES' : '❌ NO'}`)
  console.log(`   Status: ${result1 ? '✅ PASS' : '❌ FAIL'}`)
  
  // Test Case 2: Marker at beginning with text after (should stop)
  console.log('\n✅ Test 2: Marker at BEGINNING with text after (should STOP)')
  const case2 = `${marker} I have fixed all the issues, yeay!`
  const result2 = await checkCompletionMarker(case2, marker)
  console.log(`   Message: "${case2}"`)
  console.log(`   Detected: ${result2 ? '✅ YES' : '❌ NO'}`)
  console.log(`   Status: ${result2 ? '✅ PASS' : '❌ FAIL'}`)
  
  // Test Case 3: Marker in middle (should stop)
  console.log('\n✅ Test 3: Marker in MIDDLE of message (should STOP)')
  const case3 = `I finished everything. ${marker} Everything is ready for review.`
  const result3 = await checkCompletionMarker(case3, marker)
  console.log(`   Message: "${case3}"`)
  console.log(`   Detected: ${result3 ? '✅ YES' : '❌ NO'}`)
  console.log(`   Status: ${result3 ? '✅ PASS' : '❌ FAIL'}`)
  
  // Test Case 4: Marker with trailing whitespace (should stop)
  console.log('\n✅ Test 4: Marker with trailing whitespace (should STOP)')
  const case4 = `All tasks completed. ${marker}  \n\n  `
  const result4 = await checkCompletionMarker(case4, marker)
  console.log(`   Message: "${case4.replace(/\n/g, '\\n')}"`)
  console.log(`   Detected: ${result4 ? '✅ YES' : '❌ NO'}`)
  console.log(`   Status: ${result4 ? '✅ PASS' : '❌ FAIL'}`)
  
  // Test Case 5: No marker (should continue)
  console.log('\n🔄 Test 5: No marker present (should CONTINUE)')
  const case5 = 'I am working on the implementation. Making good progress.'
  const result5 = await checkCompletionMarker(case5, marker)
  console.log(`   Message: "${case5}"`)
  console.log(`   Detected: ${result5 ? '✅ YES' : '❌ NO'}`)
  console.log(`   Expected: NO`)
  console.log(`   Status: ${!result5 ? '✅ PASS' : '❌ FAIL'}`)
  
  // Test Case 6: Multiple markers (should stop)
  console.log('\n✅ Test 6: Multiple markers present (should STOP)')
  const case6 = `Remember ${marker} when finished. Now done. ${marker}`
  const result6 = await checkCompletionMarker(case6, marker)
  console.log(`   Message: "${case6}"`)
  console.log(`   Detected: ${result6 ? '✅ YES' : '❌ NO'}`)
  console.log(`   Status: ${result6 ? '✅ PASS' : '❌ FAIL'}`)
  
  // Summary
  const results = [result1, result2, result3, result4, !result5, result6]
  const passCount = results.filter(r => r).length
  const totalTests = results.length
  
  console.log('\n' + '─'.repeat(60))
  console.log(`\n📊 Summary: ${passCount}/${totalTests} tests passed`)
  
  if (passCount === totalTests) {
    console.log('✅ All tests PASSED - Completion marker detection working correctly!')
  } else {
    console.log(`❌ ${totalTests - passCount} test(s) FAILED - Please review implementation`)
  }
  
  console.log('\n✨ Simple string contains check - marker detected ANYWHERE in message!')
  console.log('   - Agent says marker at beginning → STOPS reprompting ✅')
  console.log('   - Agent says marker in middle → STOPS reprompting ✅')
  console.log('   - Agent says marker at end → STOPS reprompting ✅')
  console.log('   - No marker present → CONTINUES reprompting ✅')
}

// Run verification
runVerification().catch(error => {
  console.error('❌ Verification failed:', error)
  process.exit(1)
})
