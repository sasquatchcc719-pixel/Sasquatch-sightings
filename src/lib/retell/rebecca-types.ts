export type RetellFunctionName =
  | 'quote_and_prepare_booking'
  | 'book_prepared_slot'
  | 'get_service_catalog'
  | 'get_calendar_slots'
  | 'create_booking'
  | 'create_estimate'
  | 'list_caller_appointments'
  | 'schedule_reclean'
  | 'notify_admin'

export type RetellFunctionRequest = {
  call?: {
    call_id?: string
    from_number?: string
    to_number?: string
  }
  name?: RetellFunctionName
  function_name?: RetellFunctionName
  args?: Record<string, unknown>
  arguments?: Record<string, unknown>
}

export type RetellFunctionResponse = {
  success: boolean
  message: string
  data?: unknown
}

export type RebeccaCustomerArgs = {
  first_name: string
  last_name: string
  email: string
  phone: string
  business_name?: string | null
}

export type RebeccaAddressArgs = {
  street_1: string
  city: string
  state: string
  zip_code: string
}

export type RebeccaBookingLineItemArgs = {
  catalog_item_id?: string
  catalog_slug?: string
  name: string
  quantity: number
  unit_price: number
  total: number
  pricing_unit?: string | null
  duration_minutes?: number | null
}
