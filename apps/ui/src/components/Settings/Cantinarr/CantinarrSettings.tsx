import { t as globalT } from '@lingui/core/macro'
import { useLingui } from '@lingui/react/macro'
import {
  cantinarrSettingSchema,
  stripTrailingSlashes,
} from '@maintainerr/contracts'
import { z } from 'zod'
import ExternalServiceSettingsPage, {
  type ExternalServiceFieldConfig,
} from '../ExternalServiceSettingsPage'

const schema = z.union([
  cantinarrSettingSchema,
  z.object({ url: z.literal(''), api_key: z.literal('') }),
])
const fields = (): ExternalServiceFieldConfig[] => [
  {
    name: 'url',
    label: 'URL',
    placeholder: 'http://localhost:7474',
    normalize: stripTrailingSlashes,
    required: true,
  },
  {
    name: 'api_key',
    label: globalT`Integration token`,
    type: 'password',
    helpText: globalT`Use an expiring integration token with request and identity read permissions. Enter it again when changing the URL.`,
  },
]

export default function CantinarrSettings() {
  const { t } = useLingui()
  return (
    <ExternalServiceSettingsPage
      updatedMessage={t`Cantinarr connection saved`}
      updateErrorMessage={t`Cantinarr connection could not be saved`}
      pageTitle={t`Cantinarr settings - Maintainerr`}
      heading={t`Cantinarr Settings`}
      description={t`Connect to the Cantinarr integration API v1 build. This connection validates retained request history; it does not enable Cantinarr retention rules.`}
      docsPage="Configuration"
      settingsPath="/settings/cantinarr"
      testPath="/settings/test/cantinarr"
      schema={schema}
      fields={fields()}
      testSuccessTitle="Cantinarr"
      testFailureMessage={t`Failed to connect to Cantinarr. Check the integration build, URL, token permissions and history completeness.`}
    />
  )
}
