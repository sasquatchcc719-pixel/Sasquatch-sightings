import type {
  RecurringTemplate,
  RecurrenceRule,
  TemplateLineItem,
} from './recurring'

const nullableNumber = (value: unknown) =>
  value == null || value === '' ? null : Number(value)

export function recurringItemContent(item: TemplateLineItem) {
  return JSON.stringify({
    service: item.service_catalog_item_id || null,
    name: item.name_snapshot,
    quantity: Number(item.quantity),
    price: Number(item.unit_price),
    duration: Number(item.duration_minutes),
    buffer: Number(item.buffer_minutes || 0),
    unit: item.pricing_unit_snapshot || null,
    length: nullableNumber(item.length_value),
    width: nullableNumber(item.width_value),
    area: item.area_segments || null,
  })
}

export function recurringRulesContent(rules: Partial<RecurrenceRule>[]) {
  return JSON.stringify(
    rules
      .map((rule) =>
        JSON.stringify({
          frequency: rule.frequency,
          day: nullableNumber(rule.day_of_week),
          week: nullableNumber(rule.week_of_month),
          monthDay: nullableNumber(rule.day_of_month),
          interval: nullableNumber(rule.interval_days),
          from: rule.effective_from,
          until: rule.effective_until || null,
          time: rule.override_start_time?.slice(0, 5) || null,
        }),
      )
      .sort(),
  )
}

export function recurringEditsNeedRegeneration(
  current: RecurringTemplate & { ops_recurrence_rules: RecurrenceRule[] },
  updates: Partial<RecurringTemplate>,
  rules?: Partial<RecurrenceRule>[],
) {
  if (
    rules &&
    recurringRulesContent(rules) !==
      recurringRulesContent(current.ops_recurrence_rules)
  )
    return true
  if (
    updates.line_items &&
    JSON.stringify(updates.line_items.map(recurringItemContent)) !==
      JSON.stringify(current.line_items.map(recurringItemContent))
  )
    return true
  if (
    updates.start_time !== undefined &&
    updates.start_time.slice(0, 5) !== current.start_time.slice(0, 5)
  )
    return true
  if (
    updates.invoice_mode !== undefined &&
    updates.invoice_mode !== current.invoice_mode
  )
    return true
  return (['scheduled_duration_minutes', 'discount_amount'] as const).some(
    (key) =>
      updates[key] !== undefined &&
      Number(updates[key]) !== Number(current[key]),
  )
}
