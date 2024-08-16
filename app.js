require('dotenv').config();
const express = require('express');
const querystring = require("querystring");

const APIController = (function() {
    const clientID = process.env.CLIENT_ID;
    const clientSecret = process.env.CLIENT_SECRET;
    let state;
    let session = {
        access_token: undefined,
        refresh_token: undefined,
        expires_at: undefined
    }

    const redirectURI = "http://localhost:5000/callback";
    const authURL = "https://accounts.spotify.com/authorize";
    const tokenURL = "https://accounts.spotify.com/api/token";
    const apiBaseURL = "https://api.spotify.com/v1/";

    const getToken = async (authCode) => { // returns an access token, when given an auth code
        const result = await fetch(tokenURL, {
            method: 'POST',
            headers: {
                'Content-Type' : 'application/x-www-form-urlencoded',
                'Authorization' : 'Basic ' + btoa(clientID + ':' + clientSecret)
            },
            body: new URLSearchParams({
                grant_type: 'authorization_code',
                code: authCode,
                redirect_uri: redirectURI
            }).toString()
        });
        return await result.json(); // return the JSON object containing the access & refresh tokens
    }

    const refreshToken = async () => { // refreshes the access token, using a refresh token
        const result = await fetch(tokenURL, {
            method: 'POST',
            headers: {
                'Content-Type' : 'application/x-www-form-urlencoded',
                'Authorization' : 'Basic ' + btoa(clientID + ':' + clientSecret)
            },
            body: new URLSearchParams({
                grant_type: 'refresh_token',
                refresh_token: session.refresh_token
            }).toString()
        });
        return await result.json(); // return the JSON object containing the NEW access & refresh tokens
    }

    const checkSession = async () => { // returns true if there is a valid session, and false otherwise
        if (Date.now() > session.expires_at) { // if token has expired, go and refresh it
            console.log("Session Expired - Refreshing Access Token");
            const newTokenData = await refreshToken();
            session.access_token = newTokenData.access_token;
            session.refresh_token = newTokenData.refresh_token;
            const expires_in = newTokenData.expires_in;
            session.expires_at = Date.now() + (1000 * expires_in);
            // ^ update token information
            return true;
        }
        if (session.access_token === undefined) {
            console.log("Invalid session - Access token does not exist");
            return false;
        }
        return true; // true either way - token is either valid or has just been refreshed
    }

    const generateRandomString = length => { // generates a random string of a given length
        let result = '';
        const characters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        const charactersLength = characters.length;
        for (let i = 0; i < length; i++) {
            result += characters.charAt(Math.floor(Math.random() * charactersLength));
        }
        return result;
    };

    const getUserPlaylists = async () => {
        const result = await fetch(apiBaseURL + `me/playlists`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${session.access_token}`}
        });
        return await result.json(); // return object containing list of playlists
    }

    const getPlaylist = async (listID) => {
        const result = await fetch(apiBaseURL + `playlists/${listID}`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${session.access_token}`}
        });

        return await result.json(); // return object containing a specific playlist
    }

    const getPlaylistTracks = async (listID) => {
        const fetchLimit = 100;
        let offset = 0;
        let allTracks = [];
        let continueFetch = true;

        // continue fetching batches of 100 tracks, until there are no more left
        while (continueFetch) {
            const result = await fetch(apiBaseURL + `playlists/${listID}/tracks` + `?offset=${offset}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${session.access_token}`}
            });

            if (result.ok) {
                const data = await result.json();
                allTracks = allTracks.concat(data.items);
                offset += data.items.length;

                if (data.items.length < fetchLimit)
                    continueFetch = false;
            }
            else {
                console.log(JSON.stringify(result));
                throw new Error("Failed to fetch playlist tracks");
            }
        }

        return allTracks; // return object containing list of tracks
    }

    const getTrackArtists = (track, showURL) => {
        let str = "";
        for (let artist of track.artists) {
            if (showURL)
                str += `${getArtistURL(artist)}, `;
            else str += `${artist.name}, `;
        } // embed a clickable link to the artist's page on Spotify, if enabled
        return str.substring(0, str.length - 2); // return a comma-separated list of a track's artists
    }

    const getArtistURL = (artist) => {
        return `<a href="https://open.spotify.com/artist/${artist.id}" target="_blank" title="View ${artist.name} on Spotify">${artist.name}</a>`;
    }

    const getTrackURL = (track) => {
        return `<a href="https://open.spotify.com/track/${track.id}" target="_blank" title="Listen on Spotify">${track.name}</a>`;
    } // embed link to play the song on spotify

    const formatDate = (timestamp) => {
        const date = new Date(timestamp);

        const day = String(date.getDate()).padStart(2, '0');
        const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are zero-based, so add 1
        const year = date.getFullYear();

        // Format the date as DD/MM/YYYY
        return `${day}/${month}/${year}`;
    }

    // START OF APP EXECUTION
    const app = express(); // use ExpressJS
    app.set('view engine', 'ejs'); // use EJS files

    // login page - redirects to spotify login
    app.get('/login', (req, res) => {
        console.log("LOGIN");
        // allow access to all this user's playlists
        const scope = 'playlist-read-private playlist-read-collaborative';
        // generate random state string, for security
        state = generateRandomString(16);

        res.redirect(authURL + '?' + // redirect to spotify login page
            querystring.stringify({
                response_type: 'code',
                client_id: clientID,
                scope: scope,
                redirect_uri: redirectURI,
                state: state,
                // show_dialog: true // DEBUG - Always show the login dialog, even when already logged into an account
            }));
    });

    app.get('/callback', async (req, res) => {
        if (req.query.state === state) { // check if state matches (security)
            if (req.query.error || !req.query.code) { // if an error occurred during login
                res.send(`Authentication Failed - Reason: ${req.query.error}`);
            }
            else {
                let accessTokenData = await getToken(req.query.code); // use auth code to get tokens

                session.access_token = accessTokenData.access_token;
                session.refresh_token = accessTokenData.refresh_token;

                const expires_in = accessTokenData.expires_in;
                session.expires_at = Date.now() + (1000 * expires_in);

                if (session.access_token === undefined) { // double check that the token was obtained
                    res.send("Failed to get access token");
                }
                else {
                    res.redirect("/home"); // once successfully authenticated, take user to home page
                }
            }
        } else {
            res.send("Authentication Failed - States did not match.");
        }
    });

    app.get('/home', (req, res) => {
        res.redirect("/list");
    });

    app.get('/list', async (req, res) => {
        if (!await checkSession()) {
            res.redirect('/login'); // prompt login if session is not valid
            return;
        }

        const playlistsData = await getUserPlaylists(); // get playlists of the currently logged-in user (/me/playlists)

        const playlists = playlistsData.items;

        if (playlists.error) { // if there is some sort of error, return to the login page
            res.redirect('/login');
            return; // ALWAYS RETURN after using res, to avoid header errors!
        }

        res.render("list.ejs", { playlists: playlists}); // render html (dynamically)
    });

    app.get('/display', async (req, res) => {
        if (!await checkSession()) {
            res.redirect('/login'); // prompt login if session is not valid
            return;
        }

        if (!req.query.id) {
            res.send("No playlist selected.");
            return;
        }

        const list = await getPlaylist(req.query.id); // get playlist with the passed ID query parameter
        let tracks = await getPlaylistTracks(req.query.id);
        let numTracks = tracks.length;

        if (numTracks <= 0) {
            res.send("This playlist has no tracks.");
            return;
        }

        tracks.sort((a,b) => new Date(a.added_at) - new Date(b.added_at));
        // sort the tracks by the date they were added

        // store various data for each track, in parallel arrays
        let displayData = new Array(numTracks);
        let tooltipData = new Array(numTracks);
        let chartData = new Array(numTracks);
        let nameLabels = new Array(numTracks);

        for (let i = 0; i < numTracks; i++) {
            let track = tracks[i];
            displayData[i] = { // prepare data for displaying list of songs
                name: getTrackURL(track.track),
                artists: getTrackArtists(track.track, true),
                date: formatDate(track.added_at)
            };
            tooltipData[i] = { // prepare data for point hover tooltips
                name: track.track.name,
                artists: getTrackArtists(track.track, false)
            };
            chartData[i] = { // prepare data to be displayed on a chart
                x: track.added_at,
                y: (i+1)
            };
            nameLabels[i] = track.track.name.toString(); // prepare labels
        }

        res.render("display.ejs", {
                list_name: list.name,
                track_names: nameLabels,
                display_data: displayData,
                tooltip_data: tooltipData,
                num_tracks: numTracks,
                chart_data: chartData
        });
    });

    app.listen(5000, () => {
        console.log("Listening on port 5000");
    });

    return 0; // stops annoying intelliJ warning
});

APIController();