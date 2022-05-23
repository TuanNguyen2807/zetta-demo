
angular.module('zetta',
    ['siren', 'ui.state', 'Mac'])
.config(['classRouterProvider', '$stateProvider',
    function(classRouterProvider, $stateProvider) {

  classRouterProvider
    .when(['root'], 'overview')
    .otherwise('device');

  $stateProvider
    .state('index', {
      url: '',
      templateUrl: 'partials/start.html',
      controller: 'MainCtrl'
    })
    .state('overview', {
      url: '/overview?url&filter&query&expandQuery',
      templateUrl: 'partials/overview.html',
      controller: 'OverviewCtrl'
    })
    .state('device', {
      url: '/device?url',
      templateUrl: 'partials/device.html',
      controller: 'DeviceCtrl'
    });
  }
])
.factory('appState', function() {
  return { url: '', filter: null, query: null };
});
