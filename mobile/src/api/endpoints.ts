// Конечные точки api-v2 под теми же именами, что у внутреннего клиента сайта в desktop-версии (callEndpoint).
// Пути сверены 12.10.2026: публичные дают 200 с client_id, личные (me, лайки, история) дают 401 без входа,
// несуществующий путь даёт 404. systemPlaylist и userFollowings без входа не проверялись.

export type PathParams = Record<string, string | number>;

const table = {
    me: () => '/me',
    soundLikesIds: () => '/me/track_likes/ids',
    playlistLikesIds: () => '/me/playlist_likes/ids',
    playHistoryTracks: () => '/me/play-history/tracks',
    library: () => '/me/library/all',
    trackBatch: () => '/tracks',
    // PUT ставит лайк, DELETE снимает; путь как у лайков в вебе, на аккаунте не проверялся
    trackLike: (p: PathParams) => `/users/${seg(p, 'user_id')}/track_likes/${seg(p, 'track_id')}`,
    relatedSounds: (p: PathParams) => `/tracks/${seg(p, 'track_id')}/related`,
    searchCategory: (p: PathParams) => `/search/${seg(p, 'category')}`,
    resolve: () => '/resolve',
    recentTracks: (p: PathParams) => `/recent-tracks/${seg(p, 'tag')}`,
    mixedSelections: () => '/mixed-selections',
    systemPlaylist: (p: PathParams) => `/system-playlists/${seg(p, 'urn')}`,
    playlist: (p: PathParams) => `/playlists/${seg(p, 'id')}`,
    user: (p: PathParams) => `/users/${seg(p, 'id')}`,
    userTracks: (p: PathParams) => `/users/${seg(p, 'id')}/tracks`,
    userToptracks: (p: PathParams) => `/users/${seg(p, 'id')}/toptracks`,
    userAlbums: (p: PathParams) => `/users/${seg(p, 'id')}/albums`,
    userTrackLikes: (p: PathParams) => `/users/${seg(p, 'id')}/track_likes`,
    userFollowings: (p: PathParams) => `/users/${seg(p, 'id')}/followings`,
    userRelatedArtists: (p: PathParams) => `/users/${seg(p, 'id')}/relatedartists`,
    userPlaylistsWithoutAlbums: (p: PathParams) => `/users/${seg(p, 'id')}/playlists_without_albums`,
} as const;

export type EndpointName = keyof typeof table;

function seg(params: PathParams, key: string): string {
    const value = params[key];
    if (value === undefined || value === '') throw new Error(`Не хватает параметра пути «${key}»`);
    return encodeURIComponent(String(value));
}

export function endpointPath(name: EndpointName, params: PathParams = {}): string {
    const build = table[name] as ((p: PathParams) => string) | undefined;
    if (!build) throw new Error(`Неизвестная конечная точка «${String(name)}»`);
    return build(params);
}
