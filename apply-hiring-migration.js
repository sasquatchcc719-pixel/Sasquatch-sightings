#!/usr/bin/env node

/**
 * Apply Hiring Readiness Migration
 *
 * This script helps you apply the hiring readiness migration to your database.
 *
 * Usage:
 *   node apply-hiring-migration.js
 */

const fs = require('fs')
const path = require('path')

console.log('='.repeat(60))
console.log('🚀 Hiring Readiness Migration Helper')
console.log('='.repeat(60))
console.log()

// Read the migration file
const migrationPath = path.join(
  __dirname,
  'migrations',
  'add_hiring_readiness.sql',
)

if (!fs.existsSync(migrationPath)) {
  console.error('❌ Migration file not found:', migrationPath)
  process.exit(1)
}

const migrationSQL = fs.readFileSync(migrationPath, 'utf8')

console.log('📄 Migration file loaded:', migrationPath)
console.log()
console.log('📋 This migration will:')
console.log('  ✅ Create weekly_revenue table')
console.log('  ✅ Add hiring_threshold column to settings table')
console.log('  ✅ Add hiring_consecutive_weeks column to settings table')
console.log('  ✅ Set up RLS policies')
console.log('  ✅ Create indexes for performance')
console.log()
console.log('='.repeat(60))
console.log('🎯 APPLY THIS MIGRATION:')
console.log('='.repeat(60))
console.log()
console.log('Option 1: Supabase Dashboard (Recommended)')
console.log('------------------------------------------')
console.log('1. Go to: https://supabase.com/dashboard')
console.log('2. Select your project')
console.log('3. Navigate to: SQL Editor')
console.log('4. Click "New Query"')
console.log('5. Copy the SQL below and paste it in the editor')
console.log('6. Click "Run" or press Cmd/Ctrl + Enter')
console.log()
console.log('Option 2: Using Supabase CLI')
console.log('------------------------------------------')
console.log('Run this command:')
console.log('  supabase db execute --file migrations/add_hiring_readiness.sql')
console.log()
console.log('='.repeat(60))
console.log('📝 MIGRATION SQL:')
console.log('='.repeat(60))
console.log()
console.log(migrationSQL)
console.log()
console.log('='.repeat(60))
console.log('✅ After running the migration, start your dev server:')
console.log('   pnpm dev  (or npm run dev)')
console.log('='.repeat(60))
