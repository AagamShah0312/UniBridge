import { universityApi } from '@/api/university'
import { PageShell } from '@/components/shared/PageShell'
import { ArchiveBrowser } from '@/components/shared/ArchiveBrowser'

export default function ArchivePage() {
  return (
    <PageShell
      title="Archive"
      subtitle="The university's permanent academic record — every academic year, semester and batch ever enrolled, across all departments."
    >
      <ArchiveBrowser
        queryKey="university"
        fetchTree={() => universityApi.archive()}
        fetchSnapshot={(semesterId, batchId) => universityApi.archiveSnapshot(semesterId, batchId)}
      />
    </PageShell>
  )
}
