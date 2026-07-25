import { hodApi } from '@/api/hod'
import { PageShell } from '@/components/shared/PageShell'
import { ArchiveBrowser } from '@/components/shared/ArchiveBrowser'

export default function ArchivePage() {
  return (
    <PageShell
      title="Archive"
      subtitle="Every batch you have ever owned — by academic year and semester. Records are preserved permanently, including batches you no longer manage."
    >
      <ArchiveBrowser
        queryKey="hod"
        fetchTree={() => hodApi.archive()}
        fetchSnapshot={(semesterId, batchId) => hodApi.archiveSnapshot(semesterId, batchId)}
      />
    </PageShell>
  )
}
