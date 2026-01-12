'use client'

import { useState, useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import * as z from 'zod'
import { createClient } from '@/supabase/client'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Camera, Upload } from 'lucide-react'

// Form validation schema
const uploadFormSchema = z.object({
  image: z
    .instanceof(FileList)
    .refine((files) => files.length > 0, 'Image is required')
    .refine(
      (files) => files[0]?.type.startsWith('image/'),
      'File must be an image'
    ),
  serviceId: z.string().min(1, 'Service type is required'),
  voiceNote: z.string().optional(),
})

type UploadFormData = z.infer<typeof uploadFormSchema>

type Service = {
  id: string
  name: string
  slug: string
}

export function UploadForm() {
  const [services, setServices] = useState<Service[]>([])
  const [isLoadingServices, setIsLoadingServices] = useState(true)
  const [imagePreview, setImagePreview] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    formState: { errors },
  } = useForm<UploadFormData>({
    resolver: zodResolver(uploadFormSchema),
  })

  const imageFiles = watch('image')

  // Fetch services from Supabase
  useEffect(() => {
    async function fetchServices() {
      const supabase = createClient()
      const { data, error } = await supabase
        .from('services')
        .select('id, name, slug')
        .order('name')

      if (error) {
        console.error('Error fetching services:', error)
      } else {
        setServices(data || [])
      }
      setIsLoadingServices(false)
    }

    fetchServices()
  }, [])

  // Generate image preview
  useEffect(() => {
    if (imageFiles && imageFiles.length > 0) {
      const file = imageFiles[0]
      const objectUrl = URL.createObjectURL(file)
      setImagePreview(objectUrl)

      // Cleanup
      return () => URL.revokeObjectURL(objectUrl)
    } else {
      setImagePreview(null)
    }
  }, [imageFiles])

  const onSubmit = (data: UploadFormData) => {
    console.log('Form submitted:', {
      image: {
        name: data.image[0]?.name,
        size: data.image[0]?.size,
        type: data.image[0]?.type,
      },
      serviceId: data.serviceId,
      voiceNote: data.voiceNote,
    })
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Image Capture */}
      <div className="space-y-2">
        <Label htmlFor="image">
          <Camera className="mr-2 inline-block h-4 w-4" />
          Job Photo
        </Label>
        <Input
          id="image"
          type="file"
          accept="image/*"
          capture="environment"
          {...register('image')}
          className="cursor-pointer file:cursor-pointer"
        />
        {errors.image && (
          <p className="text-sm text-destructive">{errors.image.message}</p>
        )}

        {/* Image Preview */}
        {imagePreview && (
          <div className="mt-4">
            <img
              src={imagePreview}
              alt="Preview"
              className="h-48 w-full rounded-lg object-cover"
            />
          </div>
        )}
      </div>

      {/* Service Type Dropdown */}
      <div className="space-y-2">
        <Label htmlFor="service">Service Type</Label>
        <Select
          onValueChange={(value) => setValue('serviceId', value)}
          disabled={isLoadingServices}
        >
          <SelectTrigger id="service">
            <SelectValue
              placeholder={
                isLoadingServices ? 'Loading services...' : 'Select a service'
              }
            />
          </SelectTrigger>
          <SelectContent>
            {services.map((service) => (
              <SelectItem key={service.id} value={service.id}>
                {service.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {errors.serviceId && (
          <p className="text-sm text-destructive">{errors.serviceId.message}</p>
        )}
      </div>

      {/* Voice Note Text Field */}
      <div className="space-y-2">
        <Label htmlFor="voiceNote">Voice Note (Optional)</Label>
        <Textarea
          id="voiceNote"
          placeholder="Add notes about this job..."
          rows={4}
          {...register('voiceNote')}
        />
        <p className="text-xs text-muted-foreground">
          Voice input will be added in a future update
        </p>
      </div>

      {/* Submit Button */}
      <Button type="submit" className="w-full" size="lg">
        <Upload className="mr-2 h-4 w-4" />
        Create Job (Console Log)
      </Button>
    </form>
  )
}
