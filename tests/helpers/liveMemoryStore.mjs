export function liveMemoryStore(initial = []) {
  const records = new Map(initial.map(item => [item.id, { data: structuredClone(item), version: '1' }]))
  let revision = 1
  const get = async id => records.has(id) ? { id, ...structuredClone(records.get(id)) } : null
  const commit = async writes => {
    for (const write of writes) if ((records.get(write.id)?.version || undefined) !== write.version) return false
    for (const write of writes) records.set(write.id, { data: structuredClone(write.data), version: String(++revision) })
    return true
  }
  const query = async (tenantId, { filters = [], orderBy = '__name__', direction = 'DESCENDING', limit = 26, cursor } = {}) => {
    let rows = [...records.entries()].map(([id, row]) => ({ ...structuredClone(row.data), id })).filter(row => row.tenantId === tenantId)
    for (const filter of filters) rows = rows.filter(row => filter.op === 'IN' ? filter.value.includes(row[filter.field]) : row[filter.field] === filter.value)
    if (orderBy !== '__name__') rows = rows.filter(row => typeof row[orderBy] === 'string')
    const value = row => orderBy === '__name__' ? row.id : row[orderBy]
    const compare = (a, b) => value(a).localeCompare(value(b)) || a.id.localeCompare(b.id)
    rows.sort((a, b) => direction === 'DESCENDING' ? -compare(a, b) : compare(a, b))
    if (cursor) rows = rows.filter(row => direction === 'DESCENDING' ? value(row) < cursor.at || value(row) === cursor.at && row.id < cursor.id : value(row) > cursor.at || value(row) === cursor.at && row.id > cursor.id)
    return rows.slice(0, limit)
  }
  const createDoc = async (id, data) => {
    if (records.has(id)) return false
    records.set(id, { data: structuredClone(data), version: String(++revision) }); return true
  }
  const updateDoc = async (id, patch) => {
    const current = records.get(id)
    if (!current) throw new Error('Missing test document')
    records.set(id, { data: { ...current.data, ...structuredClone(patch) }, version: String(++revision) })
  }
  return { records, get, commit, query, createDoc, updateDoc, getDoc: async id => (await get(id))?.data || null }
}
