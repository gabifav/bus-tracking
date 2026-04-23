let map;
let busMarker;
let userMarker;
let currentDirection = "balmain";

const route445 = {
  balmain: [
    [-33.9117, 151.1034], // Campsie
    [-33.9025, 151.1260],
    [-33.8945, 151.1385],
    [-33.8848, 151.1571], // Leichhardt-ish
    [-33.8688, 151.1707],
    [-33.8587, 151.1794]  // Balmain-ish
  ],

  campsie: [
    [-33.8587, 151.1794],
    [-33.8688, 151.1707],
    [-33.8848, 151.1571],
    [-33.8945, 151.1385],
    [-33.9025, 151.1260],
    [-33.9117, 151.1034]
  ]
};

let busIndex = 0;

function startApp() {
  map = L.map("map").setView([-33.8848, 151.1571], 13);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap"
  }).addTo(map);

  drawRoute("balmain");
  createBus();

  document.getElementById("status").textContent = "Route 445 demo is running";
  document.getElementById("nextBus").textContent = "Next bus: demo bus moving now";

  setInterval(moveBus, 2000);
}

function drawRoute(direction) {
  currentDirection = direction;
  busIndex = 0;

  map.eachLayer(layer => {
    if (layer instanceof L.Polyline && !(layer instanceof L.TileLayer)) {
      map.removeLayer(layer);
    }
  });

  const route = route445[direction];

  L.polyline(route, {
    weight: 6,
    opacity: 0.8
  }).addTo(map);

  map.fitBounds(route);

  if (busMarker) {
    busMarker.setLatLng(route[0]);
  }

  const directionText = direction === "balmain" ? "To Balmain" : "To Campsie";
  document.getElementById("status").textContent = `Showing 445 ${directionText}`;
}

function createBus() {
  const busIcon = L.divIcon({
    html: "🚌",
    className: "bus-icon",
    iconSize: [30, 30]
  });

  busMarker = L.marker(route445[currentDirection][0], {
    icon: busIcon
  }).addTo(map);

  busMarker.bindPopup("Route 445 demo bus");
}

function moveBus() {
  const route = route445[currentDirection];

  busIndex++;

  if (busIndex >= route.length) {
    busIndex = 0;
  }

  const nextPosition = route[busIndex];

  busMarker.setLatLng(nextPosition);

  const minutes = Math.floor(Math.random() * 8) + 2;
  document.getElementById("nextBus").textContent = `Next bus: approx ${minutes} mins`;
}

function showDirection(direction) {
  drawRoute(direction);
}

function findMe() {
  if (!navigator.geolocation) {
    alert("Location is not supported on this device.");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    position => {
      const lat = position.coords.latitude;
      const lng = position.coords.longitude;

      if (userMarker) {
        userMarker.setLatLng([lat, lng]);
      } else {
        userMarker = L.marker([lat, lng]).addTo(map);
        userMarker.bindPopup("You are here");
      }

      map.setView([lat, lng], 15);
    },
    () => {
      alert("Could not get your location.");
    }
  );
}

startApp();