'use client'

import { useState, useEffect } from 'react'
import { createClient } from '@/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import Link from 'next/link'

export default function PartnerRegisterPage() {
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCheckingAuth, setIsCheckingAuth] = useState(true)
  
  // Track if user is already logged in (just needs partner record)
  const [existingUser, setExistingUser] = useState<{ id: string; email: string } | null>(null)
  const [step, setStep] = useState<'info' | 'credentials'>('info')

  // Partner info
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [companyWebsite, setCompanyWebsite] = useState('')
  const [homeAddress, setHomeAddress] = useState('')
  const [backlinkOptedIn, setBacklinkOptedIn] = useState(false)

  // Auth credentials (only needed for new users)
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  // Check if user is already logged in
  useEffect(() => {
    const checkAuth = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      
      if (user) {
        // User is logged in - check if they already have a partner record
        const { data: partner } = await supabase
          .from('partners')
          .select('id')
          .eq('user_id', user.id)
          .single()

        if (partner) {
          // Already has partner record - redirect to dashboard
          window.location.href = '/partners'
          return
        }

        // User exists but no partner record - they just need to fill out partner info
        setExistingUser({ id: user.id, email: user.email || '' })
        setEmail(user.email || '')
      }
      
      setIsCheckingAuth(false)
    }
    
    checkAuth()
  }, [])

  const handleInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    
    // If existing user, skip credentials step
    if (existingUser) {
      handleCreatePartnerRecord()
    } else {
      setStep('credentials')
    }
  }

  // Create partner record for existing auth user
  const handleCreatePartnerRecord = async () => {
    if (!existingUser) return
    
    setIsLoading(true)
    setError(null)

    const supabase = createClient()

    try {
      console.log('Creating partner record for user:', existingUser.id)
      
      const { data, error: partnerError } = await supabase.from('partners').insert({
        user_id: existingUser.id,
        name,
        email: existingUser.email,
        phone,
        company_name: companyName,
        company_website: companyWebsite || null,
        home_address: homeAddress,
        backlink_opted_in: backlinkOptedIn,
        role: 'partner',
        credit_balance: 0,
      }).select()

      console.log('Insert result - data:', data)
      console.log('Insert result - error:', partnerError)

      if (partnerError) {
        console.error('Supabase error (full object):', JSON.stringify(partnerError, null, 2))
        console.error('Supabase error (raw):', partnerError)
        
        // Try to extract error message from various possible structures
        const errorMsg = 
          partnerError.message || 
          (partnerError as unknown as { error_description?: string }).error_description ||
          JSON.stringify(partnerError)
        
        setError(errorMsg || 'Failed to create partner profile. Check console for details.')
        return
      }

      // Redirect to partner dashboard
      window.location.href = '/partners'
    } catch (error: unknown) {
      console.error('Partner record creation error:', error)
      const errorMessage = error instanceof Error 
        ? error.message 
        : typeof error === 'object' && error !== null && 'message' in error
          ? String((error as { message: unknown }).message)
          : 'Failed to create partner profile'
      setError(errorMessage)
    } finally {
      setIsLoading(false)
    }
  }

  // Full registration for new users
  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setIsLoading(false)
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      setIsLoading(false)
      return
    }

    const supabase = createClient()

    try {
      // 1. Create auth user
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email,
        password,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/confirm`,
        },
      })

      if (authError) throw authError

      if (!authData.user) {
        throw new Error('Failed to create user account')
      }

      // 2. Create partner record with role: 'partner'
      const { error: partnerError } = await supabase.from('partners').insert({
        user_id: authData.user.id,
        name,
        email,
        phone,
        company_name: companyName,
        company_website: companyWebsite || null,
        home_address: homeAddress,
        backlink_opted_in: backlinkOptedIn,
        role: 'partner',
        credit_balance: 0,
      })

      if (partnerError) throw partnerError

      // 3. Sign in the user
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (signInError) {
        // User was created but couldn't sign in (might need email confirmation)
        window.location.href = '/auth/sign-up-success'
        return
      }

      // 4. Redirect to partner dashboard
      window.location.href = '/partners'
    } catch (error: unknown) {
      console.error('Registration error:', error)
      setError(error instanceof Error ? error.message : 'Registration failed')
    } finally {
      setIsLoading(false)
    }
  }

  // Show loading while checking auth
  if (isCheckingAuth) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-900 via-green-800 to-emerald-900 p-4">
        <div className="text-white">Loading...</div>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-900 via-green-800 to-emerald-900 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4">
            <img
              src="/logo.svg"
              alt="Sasquatch Carpet Cleaning"
              className="h-20 w-auto"
            />
          </div>
          <CardTitle className="text-2xl">
            {existingUser ? 'Complete Your Partner Profile' : 'Partner Registration'}
          </CardTitle>
          <CardDescription>
            {existingUser 
              ? 'Fill out your partner information to access your dashboard'
              : 'Join the Sasquatch Partner Program and earn credits for referrals'
            }
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'info' ? (
            <form onSubmit={handleInfoSubmit} className="space-y-4">
              {existingUser && (
                <div className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-900/20 dark:text-blue-200">
                  Logged in as: <strong>{existingUser.email}</strong>
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="name">Full Name *</Label>
                <Input
                  id="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="John Smith"
                  required
                />
              </div>

              {!existingUser && (
                <div className="grid gap-2">
                  <Label htmlFor="email">Email *</Label>
                  <Input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="john@example.com"
                    required
                  />
                </div>
              )}

              <div className="grid gap-2">
                <Label htmlFor="phone">Phone *</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="(555) 123-4567"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="companyName">Company Name *</Label>
                <Input
                  id="companyName"
                  value={companyName}
                  onChange={(e) => setCompanyName(e.target.value)}
                  placeholder="ABC Realty"
                  required
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="companyWebsite">Company Website (Optional)</Label>
                <Input
                  id="companyWebsite"
                  type="url"
                  value={companyWebsite}
                  onChange={(e) => setCompanyWebsite(e.target.value)}
                  placeholder="https://www.abcrealty.com"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="homeAddress">Home Address *</Label>
                <Input
                  id="homeAddress"
                  value={homeAddress}
                  onChange={(e) => setHomeAddress(e.target.value)}
                  placeholder="123 Main St, Monument, CO 80132"
                  required
                />
              </div>

              <div className="flex items-start space-x-3 rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-800 dark:bg-green-900/20">
                <Checkbox
                  id="backlink"
                  checked={backlinkOptedIn}
                  onCheckedChange={(checked) =>
                    setBacklinkOptedIn(checked === true)
                  }
                  className="mt-1"
                />
                <div className="space-y-1">
                  <Label htmlFor="backlink" className="cursor-pointer font-medium">
                    Earn $25 per referral (instead of $20)
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    Add a Sasquatch backlink to your website and earn an extra $5 per
                    converted referral
                  </p>
                </div>
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading 
                  ? 'Creating Profile...' 
                  : existingUser 
                    ? 'Complete Registration' 
                    : 'Continue to Create Account'
                }
              </Button>

              {!existingUser && (
                <p className="text-center text-sm text-muted-foreground">
                  Already have an account?{' '}
                  <Link href="/auth/login" className="text-green-600 hover:underline">
                    Sign in
                  </Link>
                </p>
              )}
            </form>
          ) : (
            <form onSubmit={handleRegister} className="space-y-4">
              <div className="rounded-lg bg-muted p-3">
                <p className="text-sm">
                  <strong>Email:</strong> {email}
                </p>
                <button
                  type="button"
                  onClick={() => setStep('info')}
                  className="text-sm text-green-600 hover:underline"
                >
                  ← Go back and edit
                </button>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="password">Create Password *</Label>
                <Input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="At least 6 characters"
                  required
                  minLength={6}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="confirmPassword">Confirm Password *</Label>
                <Input
                  id="confirmPassword"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Confirm your password"
                  required
                />
              </div>

              {error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-600 dark:border-red-800 dark:bg-red-900/20">
                  {error}
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isLoading}>
                {isLoading ? 'Creating Account...' : 'Create Partner Account'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
