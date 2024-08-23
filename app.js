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
        let listURL = (listID === "me") ? 'me/tracks' : `playlists/${listID}`;
        // if the passed ID parameter is 'me', then return the user's Liked Songs

        const result = await fetch(apiBaseURL + listURL, {
            method: 'GET',
            headers: {'Authorization': `Bearer ${session.access_token}`}
        });
        return await result.json();
    }

    const getPlaylistTracks = async (listID) => {
        const fetchLimit = 100;
        let offset = 0;
        let allTracks = [];
        let continueFetch = true;
        const listURL = (listID === "me") ? 'me/tracks' : `playlists/${listID}/tracks`;

        // continue fetching batches of 100 tracks, until there are no more left
        while (continueFetch) {
            const result = await fetch(apiBaseURL + listURL + `?offset=${offset}`, {
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
            else return result.json(); // return error JSON object, if fetching the playlist tracks fails
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

    app.get('/', (req, res) => {
        res.redirect('/login');
    })


    // login page - redirects to spotify login
    app.get('/login', (req, res) => {
        console.log("LOGIN");
        // allow access to all this user's playlists
        const scope = 'playlist-read-private playlist-read-collaborative user-library-read';
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

    app.get('/list', async (req, res, next) => {
        try {
            if (!await checkSession()) {
                res.redirect('/login'); // prompt login if session is not valid
                return;
            }

            const playlists = await getUserPlaylists(); // get playlists of the currently logged-in user (/me/playlists)

            if (playlists.error) { // handle any errors when fetching the playlist data
                res.redirect('/error?' + querystring.stringify({
                    code: playlists.error.status || 500,
                    detail: playlists.error.message
                }));
                return; // ALWAYS RETURN after using res, to avoid header errors!
            }
            res.render("list.ejs", {playlists: playlists.items}); // render html (dynamically)
        }
        catch (err) {
            next(err);
        }
    });

    app.get('/display', async (req, res, next) => {
        try {
            if (!await checkSession()) {
                res.redirect('/login'); // prompt login if session is not valid
                return;
            }

            // throw new Error("Cannot divide by zero."); // DEBUG - Throw serverside error

            if (!req.query.id) { // if this page is somehow reached with no playlist selected, then
                res.redirect('/error?' + querystring.stringify({
                    code: "501",
                    detail: "No playlist was selected."
                }));
                return;
            }

            const list = await getPlaylist(req.query.id); // get playlist with the passed ID query parameter
            if (list.error) {
                res.redirect('/error?' + querystring.stringify({
                    code: list.error.status || 500,
                    detail: list.error.message
                }));
                return;
            }

            let tracks = await getPlaylistTracks(req.query.id); // get that playlist's tracks
            if (tracks.error) {
                res.redirect('/error?' + querystring.stringify({
                    code: list.error.status || 500,
                    detail: list.error.message
                }));
                return;
            }

            let numTracks = tracks.length;
            if (numTracks <= 0) {
                res.send("This playlist has no tracks.");
                return;
            }

            tracks.sort((a, b) => new Date(a.added_at) - new Date(b.added_at));
            // sort the tracks by the date they were added

            // store various data for each track, in parallel arrays
            let displayData = new Array(numTracks);
            let tooltipData = new Array(numTracks);
            let chartData = new Array(numTracks);
            let trackLinks = new Array(numTracks)

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
                    y: (i + 1)
                };
                trackLinks[i] = `https://open.spotify.com/track/${track.track.id}`; // prepare clickable links
            }

            chartData.push({x: Date.now(), y: (numTracks + 0.001)}); // make sure the size 'as of now' is displayed initially
            tooltipData.push({name: "Size as of Now", artists: numTracks});

            res.render("display.ejs", {
                list_name: list.name || "My Liked Songs",
                display_data: displayData,
                tooltip_data: tooltipData,
                track_links: trackLinks,
                num_tracks: numTracks,
                chart_data: chartData
            });
        }
        catch (err) {
            next(err);
        }
    });

    app.get('/error', (req, res) => {
        const code = parseInt(req.query.code) || 404;
        const detail = req.query.detail || "No further information.";

        let title, message;
        switch (code) {
            case 400:
                title = "Bad Request";
                message = "The server was unable to process your request. Please try again.";
                break;
            case 401:
                title = "Unauthorized";
                message = "You must be logged into a Spotify account to view this page.";
                break;
            case 403:
                title = "Forbidden";
                message = "You do not have access to this content. This may be because the playlist is private, and not yours.";
                break;
            case 404:
                title = "Not Found";
                message = "This page does not exist.";
                break;
            case 408:
                title = "Timed Out";
                message = "Your request timed out. Please try again.";
                break;
            case 500:
                title = "Internal Server Error";
                message = "The server encountered an error whilst processing your request. Please try again later.";
                break;
            case 501:
                title = "Not Implemented";
                message = "The server cannot fulfil this request.";
                break;
            case 502:
                title = "Bad Gateway";
                message = "There was a problem retrieving data from the Spotify API. Please try again later.";
                break;
            case 503:
                title = "Service Unavailable";
                message = "The Spotify API is currently unavailable. Please try again later.";
                break;
            case 504:
                title = "Gateway Timeout";
                message = "Your request to the Spotify API has timed out. Please try again.";
                break;
        }

        res.status(code).render("error.ejs", {
            error_code: code,
            error_title: title,
            error_msg: message,
            error_details: detail
        });
    });

    // redirect any unrecognised pages to the Error 404 page
    app.use((req, res, next) => {
        const pageAccessedMsg = `${req.originalUrl} is not a recognized page on this site.`;
        res.redirect(`/error?code=404&detail=${encodeURIComponent(pageAccessedMsg)}`);
    });

    // redirect to Error 500 page whenever the program encounters an exception
    app.use((err, req, res, next) => {
        console.log(err.stack || "No stack trace available.");

        const errorMessage = err.message || "Unknown Error.";
        res.redirect(`/error?code=500&detail=${encodeURIComponent(errorMessage)}`);
    });

    app.listen(5000, () => {
        console.log("Listening on port 5000");
    });

    return 0; // stops annoying intelliJ warning
});

APIController();