type EpicProfileItem = {
  templateId?: string
  quantity?: number
  attributes?: {
    platform?: string
  }
}

type EpicProfileResponse = {
  profileChanges?: Array<{
    profile?: {
      items?: Record<string, EpicProfileItem>
    }
  }>
}

export async function getEpicVBucksBalance(accountId: string, accessToken: string) {
  const url = `https://fngw-mcp-gc-livefn.ol.epicgames.com/fortnite/api/game/v2/profile/${encodeURIComponent(accountId)}/client/QueryProfile?profileId=common_core&rvn=-1`
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: "{}",
    cache: "no-store",
  })
  if (!response.ok) throw new Error(`Epic profile query returned HTTP ${response.status}`)

  const data = await response.json() as EpicProfileResponse
  const profileItems = data.profileChanges?.[0]?.profile?.items
  if (!profileItems || typeof profileItems !== "object") {
    throw new Error("Epic profile response did not contain profileChanges[0].profile.items")
  }
  const items = Object.values(profileItems)
  const breakdown: Record<string, number> = {}

  for (const item of items) {
    if (!item.templateId?.startsWith("Currency:Mtx") || item.attributes?.platform === "Nintendo") continue
    if (typeof item.quantity !== "number" || !Number.isInteger(item.quantity)) {
      throw new Error(`Epic currency item ${item.templateId} had an invalid quantity`)
    }
    const quantity = item.quantity
    breakdown[item.templateId] = (breakdown[item.templateId] ?? 0) + quantity
  }

  const totalVBucks = Object.values(breakdown).reduce((total, quantity) => total + quantity, 0)
  return { totalVBucks, formatted: `${totalVBucks} VBucks`, breakdown }
}
