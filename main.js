(function() {
  'use strict';

  // --- CONFIGURACIÓN DE LA APLICACIÓN ---
  const CONFIG = {
    firebase: {
      apiKey: "AIzaSyDIsvBenoe6l8-dv1PXehgz_lgnL-IzRXQ",
      authDomain: "mapa-interactivo-dc-yb.firebaseapp.com",
      projectId: "mapa-interactivo-dc-yb",
      storageBucket: "mapa-interactivo-dc-yb.appspot.com",
      messagingSenderId: "941318438590",
      appId: "1:941318438590:web:6b042dfce7f8d515c7a8ef"
    },
    map: {
      initialCoords: [-26.819, -65.305],
      initialZoom: 14,
      tileLayerURL: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
      attribution: '© OpenStreetMap contributors',
      minZoom: 10,       // Zoom mínimo donde los marcadores son totalmente visibles
      maxZoom: 18,       // Zoom máximo
      fadeStartZoom: 13, // Zoom donde comienza a desvanecerse
      fadeEndZoom: 10    // Zoom donde están completamente transparentes
    },
    markers: {
      types: {
        school: { icon: 'fa-solid fa-graduation-cap', label: 'Escuela' },
        party_hall: { icon: 'fa-solid fa-cake-candles', label: 'Salón de Fiestas' },
        kids_hall: { icon: 'fa-solid fa-child-reaching', label: 'Salón Infantil' },
        other: { icon: 'fa-solid fa-map-pin', label: 'Otro' }
      },
      statuses: {
        has_plan: { color: '#007bff', label: 'Tiene' },
        no_plan: { color: '#dc3545', label: 'No tiene' },
        to_verify: { color: '#28a745', label: 'A verificar' },
        to_request: { color: '#ffc107', label: 'Falta solicitar' }
      }
    }
  };

  // --- ESTADO GLOBAL DE LA APLICACIÓN ---
  const state = {
    currentUser: null,
    map: null,
    markersLayer: null,
    localMarkers: {},
    lastDeleted: null,
    editMode: false // Nuevo estado para el modo edición
  };

  // --- REFERENCIAS A ELEMENTOS DEL DOM ---
  const UI = {
    loginBtn: document.getElementById('loginBtn'),
    logoutBtn: document.getElementById('logoutBtn'),
    addMarkerBtn: document.getElementById('addMarkerBtn'),
    editModeBtn: document.getElementById('editModeBtn'), // Nueva referencia
    undoBtn: document.getElementById('undoBtn'),
    userInfo: document.getElementById('user-info'),
    mapContainer: document.getElementById('map'),
    notificationContainer: document.getElementById('notification-container')
  };

  // --- MÓDULO DE UTILIDADES ---
  const Utils = {
    showNotification(message, type = 'info') {
      const notif = document.createElement('div');
      notif.className = `notification ${type}`;
      notif.textContent = message;
      UI.notificationContainer.appendChild(notif);
      setTimeout(() => {
        notif.remove();
      }, 4000);
    },
    // NUEVA FUNCIÓN: Obtiene la dirección desde coordenadas usando la API de Nominatim (gratuita)
    async getAddressFromCoordinates(lat, lng) {
        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
            if (!response.ok) throw new Error('Respuesta de red no fue exitosa.');
            const data = await response.json();
            return data.display_name || 'Dirección no encontrada';
        } catch (error) {
            console.error("Error obteniendo la dirección:", error);
            return 'No se pudo obtener la dirección';
        }
    }
  };

  // --- MÓDULO DE FIREBASE ---
  const FirebaseModule = {
    init() {
      firebase.initializeApp(CONFIG.firebase);
      this.auth = firebase.auth();
      this.db = firebase.firestore();
      this.markersRef = this.db.collection('markers');
      this.googleProvider = new firebase.auth.GoogleAuthProvider();
    },
    onAuthStateChanged: (callback) => FirebaseModule.auth.onAuthStateChanged(callback),
    login: () => FirebaseModule.auth.signInWithPopup(FirebaseModule.googleProvider),
    logout: () => FirebaseModule.auth.signOut(),
    observeMarkers: (callback) => {
      FirebaseModule.markersRef.onSnapshot(snapshot => {
        callback(snapshot.docChanges());
      }, error => {
        console.error("Error al observar marcadores: ", error);
        Utils.showNotification("Error de conexión con la base de datos.", "error");
      });
    },
    addMarker: (data) => FirebaseModule.markersRef.add(data),
    updateMarker: (id, data) => FirebaseModule.markersRef.doc(id).update(data),
    deleteMarker: (id) => FirebaseModule.markersRef.doc(id).delete(),
    restoreMarker: (id, data) => FirebaseModule.markersRef.doc(id).set(data)
  };

  // --- MÓDULO DEL MAPA ---
  const MapModule = {
    init() {
      state.map = L.map(UI.mapContainer).setView(CONFIG.map.initialCoords, CONFIG.map.initialZoom);
  
      const callejeroLayer = L.tileLayer(CONFIG.map.tileLayerURL, { attribution: CONFIG.map.attribution });
      const topoLayer = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
      });
  
      const baseLayers = {
        "Callejero": callejeroLayer,
        "Topográfico": topoLayer
      };
  
      callejeroLayer.addTo(state.map); // Capa por defecto
      L.control.layers(baseLayers).addTo(state.map);
  
      // En lugar de usar L.layerGroup(), usar MarkerClusterGroup para agrupamiento
      state.markersLayer = L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 80, // Radio para agrupar marcadores
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        zoomToBoundsOnClick: true,
        // Personalizar los clusters
        iconCreateFunction: function(cluster) {
          const count = cluster.getChildCount();
          let color = '#007bff';
          
          if (count > 20) color = '#dc3545';
          else if (count > 10) color = '#ffc107';
          else if (count > 5) color = '#28a745';
          
          return L.divIcon({
            html: `<div style="background-color: ${color}; width: 40px; height: 40px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold; border: 3px solid white; box-shadow: 0 0 10px rgba(0,0,0,0.3);">${count}</div>`,
            className: 'marker-cluster-custom',
            iconSize: L.point(40, 40)
          });
        }
      });
      
      state.map.addLayer(state.markersLayer);
      
      this.setupEventListeners();

      // Agregar event listener para cambios de zoom
      state.map.on('zoomend', this.adjustMarkersOpacity.bind(this));
      
      // Ajustar opacidad inicial
      this.adjustMarkersOpacity();
    },
    
    // Nueva función para ajustar opacidad según el zoom
    adjustMarkersOpacity() {
      const currentZoom = state.map.getZoom();
      const { fadeStartZoom, fadeEndZoom } = CONFIG.map;
      
      let opacity = 1;
      
      if (currentZoom <= fadeStartZoom && currentZoom >= fadeEndZoom) {
        opacity = (currentZoom - fadeEndZoom) / (fadeStartZoom - fadeEndZoom);
      } else if (currentZoom < fadeEndZoom) {
        opacity = 0.1;
      }
      
      // Aplicar opacidad a marcadores individuales (no clusters)
      Object.values(state.localMarkers).forEach(marker => {
        const element = marker.getElement();
        if (element && !element.closest('.marker-cluster')) {
          element.style.opacity = opacity;
          element.style.transition = 'opacity 0.3s ease';
        }
      });
    },

    createIcon(data) {
      const type = CONFIG.markers.types[data.type] || CONFIG.markers.types.other;
      const status = CONFIG.markers.statuses[data.status] || { color: '#808080' };
      const iconHTML = `
        <div class="custom-marker-container">
          <div class="marker-label">${data.name}</div>
          <div class="marker-icon-background" style="background-color: ${status.color};">
            <i class="${type.icon}"></i>
          </div>
        </div>`;
      return L.divIcon({ html: iconHTML, className: '' });
    },
    createPopupContent(id, data) {
        const createOptions = (options, selectedValue) => 
            Object.entries(options).map(([key, value]) =>
                `<option value="${key}" ${selectedValue === key ? 'selected' : ''}>${value.label}</option>`
            ).join('');

        // Se añade el campo de dirección
        return `
            <div>
              <strong>Nombre:</strong>
              <input type="text" id="name-${id}" class="popup-input" value="${data.name || ''}" placeholder="Nombre del lugar">
              <strong>Dirección:</strong>
              <input type="text" id="address-${id}" class="popup-input" value="${data.address || ''}" placeholder="Dirección...">
              <strong>Tipo:</strong>
              <select id="type-${id}" class="popup-select">${createOptions(CONFIG.markers.types, data.type)}</select>
              <strong>Plan de Evacuación:</strong>
              <select id="status-${id}" class="popup-select">${createOptions(CONFIG.markers.statuses, data.status)}</select>
              <button class="popup-button save" data-id="${id}">Guardar</button>
              <button class="popup-button delete" data-id="${id}">Borrar</button>
            </div>`;
    },
    renderMarker(id, data) {
      if (!data.lat || !data.lng) return;
      const icon = this.createIcon(data);
      const marker = L.marker([data.lat, data.lng], { 
        icon, 
        draggable: !!state.currentUser && state.editMode 
      }).addTo(state.markersLayer);

      // Aplicar opacidad inicial basada en el zoom actual
      setTimeout(() => {
        this.adjustMarkersOpacity();
      }, 100);

      if (state.currentUser) {
        marker.bindPopup(this.createPopupContent(id, data));
        marker.on('dragend', async (event) => {
          const { lat, lng } = event.target.getLatLng();
          const address = await Utils.getAddressFromCoordinates(lat, lng);
          FirebaseModule.updateMarker(id, { lat, lng, address })
            .catch(() => Utils.showNotification("No se pudo mover el marcador.", "error"));
        });
      } else {
        const statusLabel = CONFIG.markers.statuses[data.status]?.label || 'Desconocido';
        marker.bindPopup(`<b>${data.name}</b><br><small>${data.address || ''}</small><br>Estado: ${statusLabel}`);
      }
      state.localMarkers[id] = marker;
    },
    
    // Nueva función para alternar el modo edición
    toggleEditMode() {
      state.editMode = !state.editMode;

      // Forzamos la recarga de todos los marcadores.
      // Esto asegura que el estado 'draggable' se aplique correctamente
      // a todos los marcadores, incluso a los que están agrupados (cluster).
      // Nota: Esto recarga los datos desde Firebase, lo cual puede no ser ideal
      // para el rendimiento si hay muchos marcadores.
      this.reloadAllMarkers();

      // Actualizar UI
      UI.editModeBtn.innerHTML = state.editMode ? 
        '<i class="fa-solid fa-check"></i> Finalizar Edición' : 
        '<i class="fa-solid fa-pen"></i> Editar';
      
      UI.editModeBtn.style.backgroundColor = state.editMode ? 
        'var(--success-color)' : 'var(--primary-color)';
      
      Utils.showNotification(
        state.editMode ? 
        "Modo edición activado. Puedes arrastrar los marcadores." : 
        "Modo edición desactivado.",
        state.editMode ? "info" : "success"
      );
    },
    removeMarker(id) {
      if (state.localMarkers[id]) {
        state.markersLayer.removeLayer(state.localMarkers[id]);
        delete state.localMarkers[id];
      }
    },
    // FUNCIÓN MEJORADA: Actualiza el marcador sin eliminarlo y volverlo a crear
    updateMarker(id, data) {
        const marker = state.localMarkers[id];
        if (!marker) { // Si por alguna razón el marcador no existe, lo renderiza
            this.renderMarker(id, data);
            return;
        }
        
        // Actualiza el ícono y el popup del marcador existente
        marker.setIcon(this.createIcon(data));
        if (state.currentUser) {
            marker.setPopupContent(this.createPopupContent(id, data));
        } else {
            const statusLabel = CONFIG.markers.statuses[data.status]?.label || 'Desconocido';
            marker.setPopupContent(`<b>${data.name}</b><br><small>${data.address || ''}</small><br>Estado: ${statusLabel}`);
        }
    },
    reloadAllMarkers() {
        state.markersLayer.clearLayers();
        state.localMarkers = {};
        FirebaseModule.markersRef.get().then(snapshot => {
            snapshot.forEach(doc => {
                this.renderMarker(doc.id, doc.data());
            });
        });
    },
    setupEventListeners() {
        state.map.on('popupopen', (e) => {
            const popupNode = e.popup.getElement();
            const saveBtn = popupNode.querySelector('.save');
            const deleteBtn = popupNode.querySelector('.delete');

            if (saveBtn) saveBtn.onclick = () => MarkersModule.saveMarker(saveBtn.dataset.id);
            if (deleteBtn) deleteBtn.onclick = () => MarkersModule.deleteMarker(deleteBtn.dataset.id);
        });
    }
  };

  // --- MÓDULO DE AUTENTICACIÓN ---
  const AuthModule = {
    init() {
      UI.loginBtn.addEventListener('click', () => {
        FirebaseModule.login().catch(err => Utils.showNotification("Error al iniciar sesión.", "error"));
      });
      UI.logoutBtn.addEventListener('click', FirebaseModule.logout);
      
      // Agregar event listener para el botón de edición
      UI.editModeBtn.addEventListener('click', () => {
        MapModule.toggleEditMode();
      });
      
      FirebaseModule.onAuthStateChanged(user => {
        state.currentUser = user;
        state.editMode = false; // Resetear modo edición al cambiar usuario
        this.updateUI(user);
        MapModule.reloadAllMarkers();
      });
    },
    updateUI(user) {
      if (user) {
        UI.userInfo.textContent = `Hola, ${user.displayName.split(' ')[0]}`;
        UI.loginBtn.style.display = 'none';
        UI.logoutBtn.style.display = 'block';
        UI.addMarkerBtn.disabled = false;
        UI.editModeBtn.disabled = false;
        
        // Restablecer apariencia del botón de edición
        UI.editModeBtn.innerHTML = '<i class="fa-solid fa-pen"></i> Editar';
        UI.editModeBtn.style.backgroundColor = 'var(--primary-color)';
      } else {
        UI.userInfo.textContent = '';
        UI.loginBtn.style.display = 'block';
        UI.logoutBtn.style.display = 'none';
        UI.addMarkerBtn.disabled = true;
        UI.editModeBtn.disabled = true;
        state.editMode = false;
      }
    }
  };

  // --- MÓDULO DE GESTIÓN DE MARCADORES ---
  const MarkersModule = {
    init() {
      UI.addMarkerBtn.addEventListener('click', this.addNewMarker);
      UI.undoBtn.addEventListener('click', this.undoDelete);
      this.listenForChanges();
    },
    listenForChanges() {
      FirebaseModule.observeMarkers(changes => {
        changes.forEach(change => {
          const doc = change.doc;
          const data = doc.data();
          
          if (change.type === 'removed') {
              state.lastDeleted = { id: doc.id, data: data };
              UI.undoBtn.style.display = 'block';
              setTimeout(() => { UI.undoBtn.style.display = 'none'; }, 6000);
          }

          if (change.type === 'added') MapModule.renderMarker(doc.id, data);
          if (change.type === 'modified') MapModule.updateMarker(doc.id, data);
          if (change.type === 'removed') MapModule.removeMarker(doc.id);
        });
      });
    },
    async addNewMarker() {
      if (!state.currentUser) return;
      const { lat, lng } = state.map.getCenter();
      const address = await Utils.getAddressFromCoordinates(lat, lng); // Obtener dirección para el nuevo marcador
      const newMarkerData = {
        name: "Nuevo Lugar",
        address: address, // Guardar dirección
        type: "other",
        status: "to_verify",
        lat,
        lng,
        createdBy: state.currentUser.uid,
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      FirebaseModule.addMarker(newMarkerData)
        .then(() => Utils.showNotification("Marcador agregado.", "success"))
        .catch(() => Utils.showNotification("No se pudo agregar el marcador.", "error"));
    },
    saveMarker(id) {
      const name = document.getElementById(`name-${id}`).value;
      const address = document.getElementById(`address-${id}`).value; // Leer dirección del input
      const type = document.getElementById(`type-${id}`).value;
      const status = document.getElementById(`status-${id}`).value;

      if (!name.trim()) {
        Utils.showNotification("El nombre no puede estar vacío.", "error");
        return;
      }

      const updatedData = { name, address, type, status }; // Incluir dirección al guardar
      FirebaseModule.updateMarker(id, updatedData)
        .then(() => {
          state.map.closePopup();
          Utils.showNotification("Marcador guardado.", "success");
        })
        .catch(() => Utils.showNotification("Error al guardar.", "error"));
    },
    deleteMarker(id) {
      if (window.confirm("¿Estás seguro de que quieres eliminar este marcador?")) {
        FirebaseModule.deleteMarker(id)
          .then(() => {
            Utils.showNotification("Marcador eliminado.", "info");
            state.map.closePopup();
          })
          .catch(() => Utils.showNotification("No se pudo eliminar el marcador.", "error"));
      }
    },
    undoDelete() {
        if (state.lastDeleted) {
            const { id, data } = state.lastDeleted;
            FirebaseModule.restoreMarker(id, data)
                .then(() => {
                    Utils.showNotification("Marcador restaurado.", "success");
                    state.lastDeleted = null;
                    UI.undoBtn.style.display = 'none';
                })
                .catch(() => Utils.showNotification("No se pudo restaurar.", "error"));
        }
    }
  };

  // --- INICIALIZACIÓN DE LA APLICACIÓN ---
  function initApp() {
    FirebaseModule.init();
    MapModule.init();
    AuthModule.init();
    MarkersModule.init();
    console.log("Aplicación iniciada.");
  }

  document.addEventListener('DOMContentLoaded', initApp);

})();
