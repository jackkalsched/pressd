// The debounced 4-source album search now lives in @pressd/shared. Importing
// '../api' first guarantees the shared client is configured for the web before
// the hook fires any requests.
import '../api'

export { useAlbumSearch } from '@pressd/shared/hooks/useAlbumSearch'
