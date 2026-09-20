import z from 'zod'
import { serviceUrlSchema } from '../serviceUrl'

export const cantinarrSettingSchema = z.object({
  url: serviceUrlSchema.refine((value) => {
    try {
      const url = new URL(value)
      return (
        !!url.hostname &&
        !url.username &&
        !url.password &&
        !url.search &&
        !url.hash
      )
    } catch {
      return false
    }
  }, 'A valid service URL without credentials, query or fragment is required'),
  api_key: z.string().trim().min(1, 'Integration token is required'),
})
export type CantinarrSetting = z.infer<typeof cantinarrSettingSchema>
