'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
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
  const router = useRouter()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [step, setStep] = useState<'info' | 'credentials'>('info')

  // Partner info
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [companyWebsite, setCompanyWebsite] = useState('')
  const [homeAddress, setHomeAddress] = useState('')
  const [backlinkOptedIn, setBacklinkOptedIn] = useState(false)

  // Auth credentials
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const handleInfoSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setStep('credentials')
  }

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

      // 2. Create partner record
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
        router.push('/auth/sign-up-success')
        return
      }

      // 4. Redirect to partner dashboard
      router.push('/partners')
    } catch (error: unknown) {
      console.error('Registration error:', error)
      setError(error instanceof Error ? error.message : 'Registration failed')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-green-900 via-green-800 to-emerald-900 p-4">
      <Card className="w-full max-w-lg">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
            <span className="text-3xl">🦶</span>
          </div>
          <CardTitle className="text-2xl">Partner Registration</CardTitle>
          <CardDescription>
            Join the Sasquatch Partner Program and earn credits for referrals
          </CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'info' ? (
            <form onSubmit={handleInfoSubmit} className="space-y-4">
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

              <Button type="submit" className="w-full">
                Continue to Create Account
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                Already have an account?{' '}
                <Link href="/auth/login" className="text-green-600 hover:underline">
                  Sign in
                </Link>
              </p>
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
