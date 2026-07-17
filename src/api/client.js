const baseUrl = import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '')

export async function get(path, params = {}) {
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is not configured')
  const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''))
  const response = await fetch(`${baseUrl}${path}${query.size ? `?${query}` : ''}`)
  if (!response.ok) throw new Error(`API request failed (${response.status})`)
  return response.json()
}

export async function post(path, body = {}) {
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is not configured')
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`API request failed (${response.status})`)
  return response.json()
}

// No Content-Type header here on purpose - the browser sets the multipart
// boundary itself when the body is a FormData instance.
export async function postFile(path, file) {
  if (!baseUrl) throw new Error('VITE_API_BASE_URL is not configured')
  const formData = new FormData()
  formData.append('file', file)
  const response = await fetch(`${baseUrl}${path}`, { method: 'POST', body: formData })
  if (!response.ok) {
    const detail = await response.json().catch(() => null)
    throw new Error(detail?.detail || `Upload failed (${response.status})`)
  }
  return response.json()
}
