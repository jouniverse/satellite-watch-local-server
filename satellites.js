import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.174/build/three.module.js";
import { N2YO_API_KEY } from "./apiKey.js";

// Splash screen handling
const splashScreen = document.getElementById("splashScreen");
const splashVideo = document.getElementById("splashVideo");

// Hide splash screen when video ends
splashVideo.addEventListener("ended", () => {
  gsap.to(splashScreen, {
    opacity: 0,
    duration: 0.5,
    onComplete: () => {
      splashScreen.style.display = "none";
      // Initialize the map after splash screen is hidden
      initMap();
    },
  });
});

// Map variables
let satelliteMap;
let satelliteMarker;
let mapObserverMarker;

// Three.js variables
let sphere;
let atmosphere;
let satellite;
let globeObserverMarker;

let group = new THREE.Group();

// Add global variable for active satellites
let activeSatellites = [];

// Initialize the map
function initMap() {
  satelliteMap = L.map("satelliteMap").setView([0, 0], 2);

  // Add OpenStreetMap tiles
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: "© OpenStreetMap contributors",
  }).addTo(satelliteMap);

  // Create custom icons for satellite and observer
  const satelliteIcon = L.divIcon({
    className: "satellite-icon",
    html: '<div class="w-3 h-3 rounded-full" style="background-color: #ffc0cb"></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });

  const observerIcon = L.divIcon({
    className: "observer-icon",
    html: '<div class="w-3 h-3 rounded-full" style="background-color: #f9ff50"></div>',
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });

  // Create markers with custom icons
  satelliteMarker = L.marker([0, 0], { icon: satelliteIcon }).addTo(
    satelliteMap
  );
  mapObserverMarker = L.marker([0, 0], { icon: observerIcon }).addTo(
    satelliteMap
  );
}

// Update map with satellite and observer positions
function updateMap(
  satelliteLat,
  satelliteLng,
  observerLat,
  observerLng,
  satelliteColor = ORBIT_COLORS.DEFAULT
) {
  if (satelliteMarker) {
    // Update marker position and color
    satelliteMarker.setLatLng([satelliteLat, satelliteLng]);
    const icon = satelliteMarker.getIcon();
    icon.options.html = `<div class="w-3 h-3 rounded-full" style="background-color: #${satelliteColor
      .toString(16)
      .padStart(6, "0")}"></div>`;
    satelliteMarker.setIcon(icon);
  }
  if (mapObserverMarker) {
    mapObserverMarker.setLatLng([observerLat, observerLng]);
  }
  // Center map on satellite position
  satelliteMap.setView([satelliteLat, satelliteLng], 2);
}

// Add this fetch for the satellites data
async function loadSatellites() {
  try {
    // Try to fetch from Celestrak API through our local server
    const response = await fetch(
      "http://localhost:8000/api/celestrak/gp.php?GROUP=active&FORMAT=json"
    );
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();

    // Check the data source from headers
    const dataSource = response.headers.get("X-Data-Source");
    if (dataSource === "fallback") {
      console.log("Using fallback data from satellites.json");
    } else if (dataSource === "cache") {
      console.log("Using cached data from Celestrak API");
    } else if (dataSource === "api") {
      console.log("Successfully fetched fresh data from Celestrak API");
    }

    return data;
  } catch (error) {
    console.warn("Failed to fetch from Celestrak API, using mock data:", error);
    // Fall back to mock data
    const response = await fetch("./data/json/satellites.json");
    return await response.json();
  }
}

async function loadShader(url) {
  const response = await fetch(url);
  return await response.text();
}

// Replace the direct imports
let vertexShader;
let fragmentShader;
let atmosphereVertexShader;
let atmosphereFragmentShader;

let starGeometry = new THREE.BufferGeometry();
let starMaterial = new THREE.PointsMaterial({
  color: 0xffffff,
  size: 0.01,
});

let starVertices = [];

for (let i = 0; i < 1000; i++) {
  const x = (Math.random() - 0.5) * 2000;
  const y = (Math.random() - 0.5) * 2000;
  const z = -Math.random() * 2000;
  starVertices.push(x, y, z);
}

starGeometry.setAttribute(
  "position",
  new THREE.Float32BufferAttribute(starVertices, 3)
);
let stars = new THREE.Points(starGeometry, starMaterial);

let mouse = {
  x: undefined,
  y: undefined,
  down: false,
  xPrev: undefined,
  yPrev: undefined,
};

group.rotation.offset = {
  x: 0,
  y: 0,
};

const scene = new THREE.Scene();

let canvasContainer = document.querySelector("#canvas-container");

let camera = new THREE.PerspectiveCamera(
  75,
  canvasContainer.offsetWidth / canvasContainer.offsetHeight,
  0.1,
  1000
);

scene.add(camera);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  canvas: document.querySelector("#canvas"),
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio));
renderer.setSize(canvasContainer.offsetWidth, canvasContainer.offsetHeight);

// Create globe geometry
const geometry = new THREE.SphereGeometry(5, 50, 50);

// Create satellite geometry and material
const satelliteGeometry = new THREE.SphereGeometry(0.1, 16, 16);

// Create observer marker geometry and material
const observerGeometry = new THREE.CircleGeometry(0.2, 32);
const observerMaterial = new THREE.MeshBasicMaterial({
  color: 0xf9ff50,
  transparent: true,
  opacity: 0.8,
  side: THREE.DoubleSide,
});

// Create satellite shadow geometry and material
const shadowGeometry = new THREE.CircleGeometry(0.15, 32);

// Add these constants at the top with other constants
const MIN_ZOOM = 7; // Increased minimum zoom
const MAX_ZOOM = 20; // Increased maximum zoom

// Add orbit type colors
const ORBIT_COLORS = {
  LEO: 0xffc0cb, // Pink for LEO (160-2000 km)
  MEO: 0xff4500, // Orangered for MEO (5000-20000 km)
  GEO: 0x3bf7ff, // Azure for GEO (~35786 km)
  HEO: 0xff00ff, // Magenta for HEO (high eccentricity)
  DEFAULT: 0xffc0cb, // Default red for unknown
};

// Replace the altitude scale constant with orbit heights
const ORBIT_HEIGHTS = {
  LEO: 0.5, // LEO satellites at 0.5 units above globe
  MEO: 1.25, // MEO satellites at 1.0 units above globe
  GEO: 2.0, // GEO satellites at 1.5 units above globe
  HEO: 2.25, // HEO satellites at variable height based on current position
  DEFAULT: 0.5, // Default height for unknown orbit types
};

// Function to determine orbit type based on altitude and eccentricity
function getOrbitType(altitude, eccentricity = 0) {
  // Check for HEO first based on eccentricity
  if (eccentricity > 0.1) return "HEO";

  // If not HEO, classify based on altitude
  if (altitude <= 2000) return "LEO";
  if (altitude <= 22000) return "MEO";
  return "GEO";
}

// Function to get orbit height
function getOrbitHeight(orbitType) {
  return ORBIT_HEIGHTS[orbitType] || ORBIT_HEIGHTS.DEFAULT;
}

// Helper function to convert lat/lng to 3D position
function latLngToVector3(lat, lng, radius) {
  // Convert lat/lng to radians
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);

  // Calculate 3D position
  const x = -radius * Math.sin(phi) * Math.cos(theta);
  const y = radius * Math.cos(phi);
  const z = radius * Math.sin(phi) * Math.sin(theta);

  return new THREE.Vector3(x, y, z);
}

// Function to create a satellite at a specific position
function createSatellite({
  lat,
  lng,
  name,
  noradId,
  altitude = 400,
  status = "inactive",
  eccentricity = 0, // Add eccentricity parameter
}) {
  // Determine orbit type and color using both altitude and eccentricity
  const orbitType = getOrbitType(altitude, eccentricity);
  const color = ORBIT_COLORS[orbitType] || ORBIT_COLORS.DEFAULT;
  const orbitHeight = ORBIT_HEIGHTS[orbitType] || ORBIT_HEIGHTS.DEFAULT;

  // Create satellite sphere with orbit-specific color
  const satelliteMaterial = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.8,
  });
  const satellite = new THREE.Mesh(satelliteGeometry, satelliteMaterial);
  const position = latLngToVector3(lat, lng, 5 + orbitHeight);
  satellite.position.copy(position);

  // Create shadow with matching color
  const shadowMaterial = new THREE.MeshBasicMaterial({
    color: color,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  });
  const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial);
  const shadowPosition = latLngToVector3(lat, lng, 5.02);
  shadow.position.copy(shadowPosition);

  // Make shadow face outward from globe center
  shadow.lookAt(0, 0, 0);

  // Group satellite and shadow together
  const satelliteGroup = new THREE.Group();
  satelliteGroup.add(satellite);
  satelliteGroup.add(shadow);

  satelliteGroup.name = name;
  satelliteGroup.noradId = noradId;
  satelliteGroup.satellite = satellite;
  satelliteGroup.shadow = shadow;
  satelliteGroup.orbitType = orbitType;
  satelliteGroup.orbitHeight = orbitHeight;
  satelliteGroup.color = color; // Store the color for map marker
  satelliteGroup.status = status; // Store the status

  return satelliteGroup;
}

// Function to create observer marker
function createObserverMarker(lat, lng) {
  const marker = new THREE.Mesh(observerGeometry, observerMaterial);
  const position = latLngToVector3(lat, lng, 5.01); // Slightly above the globe surface
  marker.position.copy(position);

  // Make marker face outward from globe center
  marker.lookAt(0, 0, 0);

  return marker;
}

// Function to display search results
function displaySearchResults(results, autoSelectFirst = false) {
  const searchResults = document.getElementById("searchResults");
  searchResults.innerHTML = "";

  if (results.length === 0) {
    searchResults.innerHTML =
      '<div class="text-gray-400 px-3 py-2">No results found</div>';
    return;
  }

  results.forEach((sat) => {
    const div = document.createElement("div");
    div.className =
      "bg-gray-800 text-white px-3 py-2 rounded-lg cursor-pointer hover:bg-gray-700 transition-colors";
    div.textContent = `${sat.OBJECT_NAME} (NORAD: ${sat.NORAD_CAT_ID})`;
    div.onclick = () => selectSatellite(sat);
    searchResults.appendChild(div);
  });

  // Auto-select first result if requested
  if (autoSelectFirst && results.length > 0) {
    selectSatellite(results[0]);
  }
}

// Function to update tooltip information
function updateTooltipInfo(satelliteGroup, position) {
  console.log("Updating tooltip with status:", {
    positionStatus: position.status,
    satelliteGroupStatus: satelliteGroup.status,
  });

  document.getElementById(
    "satelliteInfoEl"
  ).innerHTML = `<div class="mb-1">${satelliteGroup.name}</div>`;

  // Convert Unix timestamp to UTC date string
  const utcDate = new Date(position.timestamp * 1000).toUTCString();

  document.getElementById(
    "satelliteInfoValueEl"
  ).innerHTML = `<div class="text-sm">NORAD ID: ${satelliteGroup.noradId}</div>
     <div class="text-sm">Status: ${
       position.status || satelliteGroup.status
     }</div>
     <div class="text-sm">Orbit: ${satelliteGroup.orbitType}</div>
     <div class="text-sm">Lat: ${position.satlatitude.toFixed(2)}°</div>
     <div class="text-sm">Lng: ${position.satlongitude.toFixed(2)}°</div>
     <div class="text-sm">Alt: ${position.sataltitude.toFixed(1)} km</div>
     <div class="text-sm">Az: ${position.azimuth.toFixed(1)}°</div>
     <div class="text-sm">El: ${position.elevation.toFixed(1)}°</div>
     <div class="text-sm">Time: ${utcDate}</div>`;
}

// Add these variables at the top with other variables
let isNightMode = false;
let dayTexture = new THREE.TextureLoader().load(
  "./assets/imgs/globe-8K-blue.jpg"
);
let nightTexture = new THREE.TextureLoader().load(
  "./assets/imgs/globe-8K-night.jpg"
);

// Add this function to handle day/night toggle
function toggleDayNight() {
  isNightMode = !isNightMode;
  sphere.material.uniforms.globeTexture.value = isNightMode
    ? nightTexture
    : dayTexture;

  // Update the toggle icon
  const toggleIcon = document.querySelector("#dayNightToggle img");
  toggleIcon.src = isNightMode
    ? "./assets/icons/night-time-bl.png"
    : "./assets/icons/night-time-w.png";
}

// Add these variables at the top with other variables
let directionMarker;
let directionDot;

// Function to create direction dot for 3D globe
function createDirectionDot() {
  const dotGeometry = new THREE.CircleGeometry(0.03, 32); // Smaller radius
  const dotMaterial = new THREE.MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 1.0, // Full opacity
    side: THREE.DoubleSide,
  });
  return new THREE.Mesh(dotGeometry, dotMaterial);
}

// Modify the updateSatellitePosition function
async function updateSatellitePosition(
  satelliteGroup,
  observerLat,
  observerLng,
  observerAlt
) {
  try {
    const response = await fetch(
      `http://localhost:8000/api/n2yo/positions/${satelliteGroup.noradId}/${observerLat}/${observerLng}/${observerAlt}/10?apiKey=${N2YO_API_KEY}`
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HTTP error! status: ${response.status}, message: ${errorText}`
      );
    }

    const data = await response.json();
    console.log("Successfully fetched from N2YO API");

    if (data.positions && data.positions.length > 0) {
      const currentPosition = data.positions[0];
      const lastPosition = data.positions[data.positions.length - 1];

      // Calculate direction vector
      const dx = lastPosition.satlongitude - currentPosition.satlongitude;
      const dy = lastPosition.satlatitude - currentPosition.satlatitude;
      const length = Math.sqrt(dx * dx + dy * dy);

      // Normalize direction vector
      const dirX = dx / length;
      const dirY = dy / length;

      // Update satellite position with fixed orbit height
      const satPosition = latLngToVector3(
        currentPosition.satlatitude,
        currentPosition.satlongitude,
        5 + satelliteGroup.orbitHeight
      );
      satelliteGroup.satellite.position.copy(satPosition);

      // Update shadow position
      const shadowPosition = latLngToVector3(
        currentPosition.satlatitude,
        currentPosition.satlongitude,
        5.02
      );
      satelliteGroup.shadow.position.copy(shadowPosition);
      satelliteGroup.shadow.lookAt(0, 0, 0);

      // Update direction dot on globe surface
      if (!directionDot) {
        directionDot = createDirectionDot();
        group.add(directionDot);
      }
      const directionDotPosition = latLngToVector3(
        currentPosition.satlatitude + dirY * 1.0, // Increased distance
        currentPosition.satlongitude + dirX * 1.0, // Increased distance
        5.03 // Slightly higher than the shadow (5.02)
      );
      directionDot.position.copy(directionDotPosition);
      directionDot.lookAt(0, 0, 0);

      // Store current position data for tooltip
      satelliteGroup.currentPosition = currentPosition;

      // Update map with new positions
      updateMap(
        currentPosition.satlatitude,
        currentPosition.satlongitude,
        observerLat,
        observerLng,
        satelliteGroup.color
      );
    } else {
      console.warn("No position data received from N2YO API");
      throw new Error("No position data available");
    }
  } catch (error) {
    console.warn("Failed to fetch from N2YO API, using mock data:", error);
    // Fall back to mock data
    const mockPosition = {
      satlatitude: observerLat + (satelliteGroup.noradId % 10) * 2,
      satlongitude: observerLng + (satelliteGroup.noradId % 15) * 2,
      sataltitude: 400 + (satelliteGroup.noradId % 5) * 100,
      azimuth: 180 + (satelliteGroup.noradId % 180),
      elevation: -30 + (satelliteGroup.noradId % 60),
      timestamp: Math.floor(Date.now() / 1000),
      status: satelliteGroup.status, // Preserve the satellite's status
    };

    // Update satellite position with fixed orbit height
    const satPosition = latLngToVector3(
      mockPosition.satlatitude,
      mockPosition.satlongitude,
      5 + satelliteGroup.orbitHeight
    );
    satelliteGroup.satellite.position.copy(satPosition);

    // Update shadow position
    const shadowPosition = latLngToVector3(
      mockPosition.satlatitude,
      mockPosition.satlongitude,
      5.02
    );
    satelliteGroup.shadow.position.copy(shadowPosition);
    satelliteGroup.shadow.lookAt(0, 0, 0);

    // Store current position data for tooltip
    satelliteGroup.currentPosition = mockPosition;

    // Update direction dot on globe surface with mock direction
    if (!directionDot) {
      directionDot = createDirectionDot();
      group.add(directionDot);
    }
    const mockDirection = { dirX: 0.1, dirY: 0.1 }; // Mock direction for testing
    const directionDotPosition = latLngToVector3(
      mockPosition.satlatitude + mockDirection.dirY * 1.0,
      mockPosition.satlongitude + mockDirection.dirX * 1.0,
      5.03 // Slightly higher than the shadow (5.02)
    );
    directionDot.position.copy(directionDotPosition);
    directionDot.lookAt(0, 0, 0);

    // Update map with mock positions
    updateMap(
      mockPosition.satlatitude,
      mockPosition.satlongitude,
      observerLat,
      observerLng,
      satelliteGroup.color
    );
  }
}

// Function to search satellites
function searchSatellites(satellites, searchTerm) {
  if (!searchTerm || searchTerm.length < 2) return [];

  searchTerm = searchTerm.toLowerCase();
  return satellites
    .filter(
      (sat) =>
        sat.OBJECT_NAME.toLowerCase().includes(searchTerm) ||
        sat.NORAD_CAT_ID.toString().includes(searchTerm)
    )
    .map((sat) => ({
      ...sat,
      STATUS: "active", // These are from the active satellites list
    }))
    .slice(0, 50); // Limit results to 50 for better performance
}

// Function to select a satellite
function selectSatellite(satelliteData) {
  // Clear any existing update interval
  if (window.positionUpdateInterval) {
    clearInterval(window.positionUpdateInterval);
  }

  // Remove existing satellite if any
  if (satellite) {
    group.remove(satellite);
  }

  // Calculate altitude from mean motion (approximate)
  const meanMotion = satelliteData.MEAN_MOTION;
  const altitude =
    Math.pow(
      398600.4418 / Math.pow((meanMotion * 2 * Math.PI) / 86400, 2),
      1 / 3
    ) - 6378.137;

  // Create new satellite with calculated altitude and eccentricity
  satellite = createSatellite({
    lat: 0,
    lng: 0,
    name: satelliteData.OBJECT_NAME,
    noradId: satelliteData.NORAD_CAT_ID,
    altitude: altitude,
    status: satelliteData.STATUS || "inactive",
    eccentricity: satelliteData.ECCENTRICITY || 0, // Add eccentricity
  });

  group.add(satellite);

  // Update position
  const observerLat = parseFloat(document.getElementById("observerLat").value);
  const observerLng = parseFloat(document.getElementById("observerLng").value);
  const observerAlt = parseFloat(document.getElementById("observerAlt").value);

  // Update position without rotation
  updateSatellitePosition(satellite, observerLat, observerLng, observerAlt);

  // Update position every 10 seconds without rotation
  window.positionUpdateInterval = setInterval(() => {
    updateSatellitePosition(satellite, observerLat, observerLng, observerAlt);
  }, 10000);
}

// Add debounce function for search
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

// load search categories
async function loadSearchCategories() {
  try {
    const response = await fetch("./data/json/search-categories.json");
    const categories = await response.json();
    return categories;
  } catch (error) {
    console.warn("Failed to load search categories:", error);
    return [];
  }
}

// populate category select
function populateCategorySelect(categories) {
  const select = document.getElementById("categorySelect");
  categories.forEach((category) => {
    const option = document.createElement("option");
    option.value = category.id;
    option.textContent = category.Category;
    select.appendChild(option);
  });
}

// search satellites above
async function searchSatellitesAbove(categoryId = "") {
  const observerLat = parseFloat(document.getElementById("observerLat").value);
  const observerLng = parseFloat(document.getElementById("observerLng").value);
  const observerAlt = parseFloat(document.getElementById("observerAlt").value);

  try {
    // Clear the search input
    document.getElementById("satelliteSearch").value = "";

    // Construct the URL with optional category
    let url = `http://localhost:8000/api/n2yo/above/${observerLat}/${observerLng}/${observerAlt}/70`;
    if (categoryId) {
      url += `/${categoryId}`;
    }
    url += `?apiKey=${N2YO_API_KEY}`;

    console.log("Requesting URL:", url); // Debug log
    const response = await fetch(url);
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `HTTP error! status: ${response.status}, message: ${errorText}`
      );
    }

    const data = await response.json();
    console.log("Successfully fetched satellites above");

    // Convert the response to match our satellite data format
    const satellites = data.above.map((sat) => {
      // Calculate mean motion based on altitude
      // For circular orbits: meanMotion = sqrt(398600.4418 / (altitude + 6378.137)^3) * 86400 / (2π)
      const altitude = sat.satalt;
      const meanMotion =
        (Math.sqrt(398600.4418 / Math.pow(altitude + 6378.137, 3)) * 86400) /
        (2 * Math.PI);

      // Check if satellite is active
      const isActive = activeSatellites.some(
        (activeSat) => activeSat.NORAD_CAT_ID === sat.satid
      );

      return {
        OBJECT_NAME: sat.satname,
        NORAD_CAT_ID: sat.satid,
        MEAN_MOTION: meanMotion,
        // Add other required fields with calculated values
        EPOCH: new Date().toISOString(),
        ECCENTRICITY: 0.0001, // Assuming near-circular orbit
        INCLINATION: altitude > 35786 ? 0 : 90, // GEO satellites have 0° inclination
        RA_OF_ASC_NODE: 0,
        ARG_OF_PERICENTER: 0,
        MEAN_ANOMALY: 0,
        EPHEMERIS_TYPE: 0,
        CLASSIFICATION_TYPE: "U",
        ELEMENT_SET_NO: 999,
        REV_AT_EPOCH: 0,
        BSTAR: 0,
        MEAN_MOTION_DOT: 0,
        MEAN_MOTION_DDOT: 0,
        STATUS: isActive ? "active" : "inactive",
      };
    });

    // Display results
    displaySearchResults(satellites);
  } catch (error) {
    console.warn("Failed to fetch satellites above, using mock data:", error);
    // Fall back to mock data
    const mockSatellites = Array.from({ length: 5 }, (_, i) => ({
      OBJECT_NAME: `Mock Satellite ${i + 1}`,
      NORAD_CAT_ID: 1000 + i,
      MEAN_MOTION: 15.0,
      // Add other required fields with default values
      EPOCH: new Date().toISOString(),
      ECCENTRICITY: 0.0001,
      INCLINATION: 90,
      RA_OF_ASC_NODE: 0,
      ARG_OF_PERICENTER: 0,
      MEAN_ANOMALY: 0,
      EPHEMERIS_TYPE: 0,
      CLASSIFICATION_TYPE: "U",
      ELEMENT_SET_NO: 999,
      REV_AT_EPOCH: 0,
      BSTAR: 0,
      MEAN_MOTION_DOT: 0,
      MEAN_MOTION_DDOT: 0,
      STATUS: "inactive", // Mock satellites are always inactive
    }));
    displaySearchResults(mockSatellites);
  }
}

// load countries
async function loadCountries() {
  try {
    const response = await fetch("./data/json/countries.json");
    const countries = await response.json();
    return countries;
  } catch (error) {
    console.warn("Failed to load countries:", error);
    return [];
  }
}

// populate country select
function populateCountrySelect(countries) {
  const select = document.getElementById("countrySelect");

  // Sort countries by name
  countries.sort((a, b) => a.name.common.localeCompare(b.name.common));

  countries.forEach((country) => {
    const option = document.createElement("option");
    option.value = JSON.stringify(country.latlng);
    option.textContent = country.name.common;
    select.appendChild(option);
  });

  // Add event listener for country selection
  select.addEventListener("change", (e) => {
    if (e.target.value) {
      const [lat, lng] = JSON.parse(e.target.value);
      document.getElementById("observerLat").value = lat;
      document.getElementById("observerLng").value = lng;

      // Trigger change events to update the globe and map
      document.getElementById("observerLat").dispatchEvent(new Event("change"));
      document.getElementById("observerLng").dispatchEvent(new Event("change"));
    }
  });
}

// init
async function init() {
  // Load all required data
  const [
    satellitesData,
    categories,
    countries,
    vertexShaderText,
    fragmentShaderText,
    atmosphereVertexShaderText,
    atmosphereFragmentShaderText,
  ] = await Promise.all([
    loadSatellites(),
    loadSearchCategories(),
    loadCountries(),
    loadShader("./shaders/vertex.glsl"),
    loadShader("./shaders/fragment.glsl"),
    loadShader("./shaders/atmosphereVertex.glsl"),
    loadShader("./shaders/atmosphereFragment.glsl"),
  ]);

  // Store active satellites list
  activeSatellites = satellitesData;

  // Populate category select
  populateCategorySelect(categories);

  // Populate country select
  populateCountrySelect(countries);

  // Add event listener for the "Above" search button
  document.getElementById("searchAbove").addEventListener("click", () => {
    const categoryId = document.getElementById("categorySelect").value;
    searchSatellitesAbove(categoryId);
  });

  // Assign shader text to variables
  vertexShader = vertexShaderText;
  fragmentShader = fragmentShaderText;
  atmosphereVertexShader = atmosphereVertexShaderText;
  atmosphereFragmentShader = atmosphereFragmentShaderText;

  const material = new THREE.ShaderMaterial({
    vertexShader: vertexShader,
    fragmentShader: fragmentShader,
    uniforms: {
      globeTexture: {
        value: new THREE.TextureLoader().load(
          "./assets/imgs/globe-8K-blue.jpg"
        ),
      },
    },
  });
  sphere = new THREE.Mesh(geometry, material);

  scene.add(sphere);

  const atmosphereGeometry = geometry.clone();

  const atmosphereMaterial = new THREE.ShaderMaterial({
    vertexShader: atmosphereVertexShader,
    fragmentShader: atmosphereFragmentShader,
    blending: THREE.AdditiveBlending,
    side: THREE.BackSide,
  });

  atmosphere = new THREE.Mesh(atmosphereGeometry, atmosphereMaterial);
  atmosphere.scale.set(1.1, 1.1, 1.1);
  scene.add(atmosphere);

  group.add(sphere);
  scene.add(group);

  scene.add(stars);

  camera.position.z = 10;

  // Create initial observer marker
  const observerLat = parseFloat(document.getElementById("observerLat").value);
  const observerLng = parseFloat(document.getElementById("observerLng").value);
  globeObserverMarker = createObserverMarker(observerLat, observerLng);
  group.add(globeObserverMarker);

  // Add debounced event listener for search
  const debouncedSearch = debounce((e) => {
    const results = searchSatellites(satellitesData, e.target.value);
    displaySearchResults(results);
  }, 300);

  document
    .getElementById("satelliteSearch")
    .addEventListener("input", debouncedSearch);

  document.getElementById("showISS").addEventListener("click", () => {
    const iss = satellitesData.find((sat) => sat.NORAD_CAT_ID === 25544);
    if (iss) {
      displaySearchResults([{ ...iss, STATUS: "active" }], true); // Show ISS in search results and auto-select it
    }
  });

  document.getElementById("showStarlink").addEventListener("click", () => {
    const starlinks = satellitesData
      .filter((sat) => sat.OBJECT_NAME.toLowerCase().includes("starlink"))
      .map((sat) => ({ ...sat, STATUS: "active" })); // Preserve STATUS field
    displaySearchResults(starlinks);
  });

  document.getElementById("showGPS").addEventListener("click", () => {
    const gpsSatellites = satellitesData
      .filter((sat) => sat.OBJECT_NAME.toLowerCase().includes("navstar"))
      .map((sat) => ({ ...sat, STATUS: "active" })); // Preserve STATUS field
    displaySearchResults(gpsSatellites);
  });

  document.getElementById("showHEO").addEventListener("click", () => {
    const heoSatellites = satellitesData
      .filter((sat) => (sat.ECCENTRICITY || 0) > 0.1)
      .map((sat) => ({ ...sat, STATUS: "active" })); // Preserve STATUS field
    displaySearchResults(heoSatellites);
  });

  // Update observer marker when position changes
  ["observerLat", "observerLng", "observerAlt"].forEach((id) => {
    document.getElementById(id).addEventListener("change", () => {
      const lat = parseFloat(document.getElementById("observerLat").value);
      const lng = parseFloat(document.getElementById("observerLng").value);
      group.remove(globeObserverMarker);
      globeObserverMarker = createObserverMarker(lat, lng);
      group.add(globeObserverMarker);

      // Update satellite position if one is selected
      if (satellite) {
        updateSatellitePosition(
          satellite,
          lat,
          lng,
          parseFloat(document.getElementById("observerAlt").value)
        );
      } else {
        // If no satellite is selected, just update the map with the new observer position
        updateMap(0, 0);
      }
    });
  });

  // Add day/night toggle event listener
  document
    .getElementById("dayNightToggle")
    .addEventListener("click", toggleDayNight);

  // Start animate loop only after initialization is complete
  animate();
}

let raycaster = new THREE.Raycaster();
let popUpEl = document.querySelector("#popUpEl");

function animate() {
  requestAnimationFrame(animate);

  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(
    group.children
      .flatMap((child) =>
        child instanceof THREE.Group ? [child.satellite] : [child]
      )
      .filter((mesh) => {
        return (
          mesh.geometry.type === "SphereGeometry" ||
          mesh.geometry.type === "CircleGeometry"
        );
      })
  );

  // Hide popup by default
  gsap.set(popUpEl, {
    display: "none",
  });

  // Handle intersections
  if (intersects.length > 0) {
    const intersectedObject = intersects[0].object;
    const satelliteGroup =
      intersectedObject.parent instanceof THREE.Group
        ? intersectedObject.parent
        : null;

    if (
      satelliteGroup &&
      satelliteGroup.name &&
      satelliteGroup.currentPosition
    ) {
      // This is a satellite
      gsap.set(popUpEl, {
        display: "block",
      });
      updateTooltipInfo(satelliteGroup, satelliteGroup.currentPosition);
    }
  }

  renderer.render(scene, camera);
}

// Call init but remove the separate animate() call
init();

canvasContainer.addEventListener("mousedown", ({ clientX, clientY }) => {
  mouse.down = true;
  mouse.xPrev = clientX;
  mouse.yPrev = clientY;
});

addEventListener("mousemove", (e) => {
  const rect = document
    .querySelector("#canvas-container")
    .getBoundingClientRect();
  mouse.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  mouse.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  gsap.set(popUpEl, {
    x: e.clientX,
    y: e.clientY,
  });

  if (mouse.down) {
    e.preventDefault();
    const deltaX = e.clientX - mouse.xPrev;
    const deltaY = e.clientY - mouse.yPrev;
    // Fix rotation direction for both X and Y
    group.rotation.offset.x += deltaY * 0.002;
    group.rotation.offset.y += deltaX * 0.002;
    gsap.to(group.rotation, {
      y: group.rotation.offset.y,
      x: group.rotation.offset.x,
      duration: 2,
    });

    mouse.xPrev = e.clientX;
    mouse.yPrev = e.clientY;
  }
});

addEventListener("mouseup", (e) => {
  mouse.down = false;
});

// Replace the wheel event listener with this updated version
addEventListener(
  "wheel",
  (e) => {
    // Only handle wheel events if they're not from the sidebar
    if (e.target.closest(".xl\\:w-1\\/3")) {
      return;
    }

    e.preventDefault();
    const delta = e.deltaY;
    const currentZ = camera.position.z;

    // Calculate new camera position
    let newZ = currentZ + delta * 0.01;

    // Clamp the zoom level
    newZ = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, newZ));

    // Smoothly animate the camera
    gsap.to(camera.position, {
      z: newZ,
      duration: 0.3,
    });
  },
  { passive: false }
);

//  resize
addEventListener("resize", () => {
  renderer.setSize(canvasContainer.offsetWidth, canvasContainer.offsetHeight);
  camera.aspect = canvasContainer.offsetWidth / canvasContainer.offsetHeight;
  camera.updateProjectionMatrix();
});

// Prevent wheel events from affecting the globe when scrolling the satellite list
document.getElementById("searchResults").addEventListener("wheel", (e) => {
  e.stopPropagation();
});
