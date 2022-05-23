angular.module('zetta').controller('OverviewCtrl', [
  '$scope', '$state', '$http', '$location', '$window', 'navigator', 'zettaShared', 
    function($scope, $state, $http, $location, $window, navigator, zettaShared ) {

  $scope.emptyFilter = function() {
    return {
      field: null,
      operator: 'eq',
      value: null
    }
  };

  $scope.pinned = zettaShared.state.pinned;
  $scope.servers = zettaShared.state.servers;
  $scope.muted = zettaShared.state.muted;
  $scope.query = zettaShared.state.query;
  $scope.showAdvancedQuery = false;
  $scope.activeQuery = null; 
  $scope.queryError = null;
  $scope.isAdvancedQueryVisible = false;
  $scope.queryFilters = [$scope.emptyFilter()];
  $scope.queryInProgress = false;
  $scope.propertyNameIndex = [];
  
  $scope.pageNav = null;
  $scope.loading = true;
  $scope.hasDevices = false;

  $scope.containsKey = function(streams, name){
    var names = streams.map(function(s){ return s.name; });
    if(names.indexOf(name) > -1){ return true; }
    else { return false; }
  }
  
  $scope.toggleProperties = function(repeatScope) {
    if(repeatScope.showProperties){
      repeatScope.showProperties = false
    }
    else {
      repeatScope.showProperties = true;
    }
  }
      
  $scope.init = function() {
    loadServers();
    if (!$scope.activeQuery) {
      $scope.query = null;
      zettaShared.state.query = null;
    }

    if ($state.params.query === 'null') {
      delete $state.params.query;
    }

    if ($state.params.expandQuery) {
      $scope.showAdvancedQuery();
    }
  };

  $scope.$watch('pageNav', function() {
    if ($scope.pageNav === null) {
      return;
    }

    if($('#' + $scope.pageNav).length){
      var pos = $('#' + $scope.pageNav)[0].offsetTop - $('nav:first').height() - $('#wampum').height() -32;
      
      $(window).scrollTop(pos);
      $scope.pageNav = null;
    }
  });

  $scope.hideAdvancedQuery = function() {
    $scope.isAdvancedQueryVisible = false;

    if (!$state.params.filter) {
      delete $state.params.filter;
    }

    if (!$state.params.query) {
      delete $state.params.query;
    }

    delete $state.params.expandQuery;
    $location.search($state.params);
  };

  $scope.showAdvancedQuery = function() {
    $scope.isAdvancedQueryVisible = true;

    if (!$state.params.filter) {
      delete $state.params.filter;
    }

    $state.params.expandQuery = true;

    $location.search($state.params);
  };

  $scope.toggleAdvancedQuery = function() {
    if ($scope.isAdvancedQueryVisible) {
      $scope.hideAdvancedQuery();
    } else {
      $scope.showAdvancedQuery();
    }
  };

  $scope.availableDevices = function(server) {
    if (!server.devices) {
      return [];
    }

    return server.devices.filter(function(device) {
      return device.available;
    });
  }

  $scope.clearQuery = function() {
    $scope.servers.forEach(function(server) {
      server.lastSearch = null;
      if (server.devices) {
        server.devices.forEach(function(device) {
          device.available = true;
        });
      }
    });

    $scope.activeQuery = null;
    $scope.query = null;
    $scope.queryError = null;
    $scope.queryFilters = [$scope.emptyFilter()];
    zettaShared.state.query = null;

    delete $state.params.query;
    if (!$state.params.filter) {
      delete $state.params.filter;
    }

    if (!$state.params.expandQuery) {
      delete $state.params.expandQuery;
    }

    $location.search($state.params);
  };


  $scope.setQueryFilters = function(filters) {
    $scope.queryFilters = filters;
  }

  $scope.submitAdvancedQuery = function() {
    var expressions = [];
    $scope.queryFilters.forEach(function(filter) {
      var value = filter.value;
      if (isNaN(Number(value))) {
        value = JSON.stringify(value);
      } else {
        value = Number(value);
      }

      var comparisons = ['eq', 'gt', 'gte', 'lt', 'lte'];

      if (comparisons.indexOf(filter.operator) !== -1) {
        expressions.push(new CaqlAst.ComparisonPredicateNode(filter.field, filter.operator, value));
      } else if (filter.operator === 'like') {
        expressions.push(new CaqlAst.LikePredicateNode(filter.field, filter.value));
      }
    });

    var filterNode;
    if (expressions.length === 1) {
      filterNode = new CaqlAst.FilterNode(expressions[0]);
    } else {
      var conjunction = expressions.reduce(function(prev, curr) {
        if (!prev.left) {
          prev.left = curr;
          return prev;
        } else if (!prev.right) {
          prev.right = curr;
          return prev;
        } else {
          return new CaqlAst.ConjunctionNode(prev, curr);
        }
      }, new CaqlAst.ConjunctionNode());

      filterNode = new CaqlAst.FilterNode(conjunction);
    }

    var ast = new CaqlAst.SelectStatementNode(new CaqlAst.FieldListNode(), filterNode, null);

    var decompiler = new CaqlDecompiler();
    var ql = decompiler.decompile(ast);

    $scope.query = ql;
    $scope.submitQuery();
  };

  $scope.updateQueryFilters = function(parsed) {
      var filters = [];

      var cancel = false;
      var next = function(node) {
        if (node.type === 'Disjunction') {
          cancel = true;
          return;
        }

        if (node.type === 'Conjunction') {
          next(node.left);
          next(node.right);
        } else {
          filters.push({
            field: node.field,
            operator: node.operator,
            value: node.value === undefined ? undefined : JSON.parse(node.value)
          });
        }
      };

      next(parsed.filterNode.expression);

      $scope.queryFilters = cancel ? [$scope.emptyFilter()] : filters;
  };

  $scope.checkAndSubmitQuery = function() {
    if ($scope.isAdvancedQueryVisible) {
      $scope.submitAdvancedQuery();
    } else {
      $scope.submitQuery();
    }
  };

  $scope.submitQuery = function() {
    var isValid = false;
    var parsed;

    $scope.query = $scope.query.trim();

    if (!$scope.query) {
      $scope.clearQuery();
      return;
    }

    var where = 'where';
    if ($scope.query.toLowerCase().substr(0, where.length) !== where) {
      $scope.query = 'where ' + $scope.query;
    }

    $scope.isAdvancedQueryVisible = false;

    try {
      parsed = caql.parse($scope.query);
      $scope.queryError = null;
      $scope.activeQuery = $scope.query;
      isValid = true;
      zettaShared.state.query = $scope.query;
    } catch(e) {
      $scope.queryError = e.message;
      $scope.activeQuery = null;
    }

    if (!isValid || !$scope.servers.length) {
      return;
    }

    $scope.updateQueryFilters(parsed);

    $scope.queryInProgress = true;
    $scope.servers.forEach(function(server, serverIndex) {
      var queryActions = server.actions.filter(function(action) {
        return action.name === 'query-devices';
      });

      if (!queryActions.length) {
        return;
      }

      var queryAction = queryActions[0];

      var qlFields = queryAction.fields.filter(function(field) {
        return field.name === 'ql';
      });

      if (!qlFields.length) {
        return;
      }

      var qlField = qlFields[0];

      qlField.value = $scope.query;

      if (server.devices) {
        server.devices.forEach(function(device) {
          device.available = false;
        });
      }

      $state.params.query = $scope.query;
      if (!$state.params.filter) {
        delete $state.params.filter;
      }
      if (!$state.params.expandQuery) {
        delete $state.params.expandQuery;
      }
      $location.search($state.params);

      queryAction.execute(function(result) {
        server.lastSearch = result.config.url;
        var data = result.data;
        if (!data.entities.length) {
          if (serverIndex === $scope.servers.length - 1) {
            $scope.queryInProgress = false;
          }
          return;
        }
        data.entities.forEach(function(entity) {
          var selfHref;

          entity.links.forEach(function(link) {
            if (link.rel.indexOf('self') !== -1) {
              selfHref = link.href;
            }
          });

          if (!selfHref) {
            return;
          }

          server.devices.forEach(function(device) {
            if (device.href === selfHref) {
              device.available = true;
            }
          });
        });

        if (serverIndex === $scope.servers.length - 1) {
          $scope.queryInProgress = false;
        }
      });
    });
  };
      
  function loadServers() {
    
    zettaShared.state.root = $state.params.url;
    zettaShared.state.breadcrumbs = [];
    zettaShared.state.onStreamUpdate = function() {
      $scope.$apply();
    };

    var rootUrl = zettaShared.state.root;

    if (!rootUrl) {
      var parser = document.createElement('a');
      parser.href = $state.params.url;
      rootUrl = parser.protocol + '//' + parser.hostname;
      if (parser.port) {
        rootUrl += ':' + parser.port;
      }

      zettaShared.state.root = rootUrl;
    }

    if ($state.params.filter) {
      $scope.filter = $state.params.filter;

      zettaShared.state.breadcrumbs = [
        { title: 'root', href: $state.params.url },
        { title: $state.params.filter }
      ];
    }

    if (!zettaShared.state.servers.length) {
      zettaShared.state.loadServers(rootUrl, function() {
        if ($state.params.filter) {
          filterServer();
          if ($state.params.query) {
            $scope.query = $state.params.query;
            $scope.submitQuery();
          }
        } else {
          zettaShared.state.servers.forEach(function(server) {
            server.available = true;
            if (server.devices && !$scope.hasDevices) {
              $scope.hasDevices = true;
              server.devices.forEach(function(device) {
                Object.keys(device.properties).forEach(function(key) {
                  if ($scope.propertyNameIndex.indexOf(key) === -1) {
                    $scope.propertyNameIndex.push(key);
                    $scope.propertyNameIndex.sort();
                  }
                });
              });
            }
          })
        }

        $scope.loading = false;

        if ($state.params.query) {
          $scope.query = $state.params.query;
          $scope.submitQuery();
        }
      });
    } else {
      if ($state.params.filter) {
        filterServer();
        if ($state.params.query) {
          $scope.query = $state.params.query;
          $scope.submitQuery();
        }
      } else {
        zettaShared.state.servers.forEach(function(server) {
          server.available = true;
          if (server.devices && !$scope.hasDevices) {
            $scope.hasDevices = true;
          }

          server.devices.forEach(function(device) {
            device.available = true;
          });
        })
      }
      $scope.loading = false;
      if ($state.params.query) {
        $scope.query = $state.params.query;
        $scope.submitQuery();
      }
    }
  }

  $scope.loadServer = function(server) {
    $state.params.filter = server.name;
    if (!$state.params.query) {
      delete $state.params.query;
    }

    if (!$state.params.expandQuery) {
      delete $state.params.expandQuery;
    }

    $location.search($state.params);
    loadServers();
    $window.scrollTo(0, 0);
    
  };

  var filterServer = function() {
    var width = $('.dnastrip canvas').width();
    var height = $('.dnastrip canvas').height();

    $scope.servers.forEach(function(server) {
      if (server.devices && !$scope.hasDevices) {
        $scope.hasDevices = true;
      }

      if (server.name !== $state.params.filter) {
        server.available = false;
      } else {
        if (!server.devices) {
          return;
        }

        server.devices.forEach(function(device) {
          if (!device.streams) {
            return;
          }

          device.streams.forEach(function(stream) {
            if (typeof stream.refresh === 'function') {
              setTimeout(function() {
                stream.refresh(width);
              }, 100);
            }
          });
        });
      }
    });
  };

  $scope.resolve = function(href) {
    navigator.transitionTo(href, { url: href });
  };

  $scope.pin = function(characteristic) {
    characteristic.pinned = true;

    if (characteristic.muted) {
      $scope.unmute(characteristic);
    }
    if ($scope.pinned.indexOf(characteristic) === -1) {
      $scope.pinned.push(characteristic);
      setTimeout(function() {
        characteristic.pinOpen = true;
        $scope.$apply();
      }, 1);
    } else {
      $scope.unpin(characteristic);
    }
  };

  $scope.unpin = function(characteristic) {
    var index = $scope.pinned.indexOf(characteristic);
    if (index > -1) {
      characteristic.pinned = false;
      characteristic.pinOpen = false;
      setTimeout(function() {
        $scope.pinned.splice(index, 1);
        $scope.$apply();
      }, 1);
    }
  };

  $scope.mute = function(characteristic) {
    if (characteristic.pinned) {
      $scope.unpin(characteristic);
    }

    if ($scope.muted.indexOf(characteristic) === -1) {
      $scope.muted.push(characteristic);
      setTimeout(function() {
        characteristic.open = false;
        characteristic.muteOpen = true;
        $scope.$apply(function() {
          setTimeout(function() {
            characteristic.muted = true;
            $scope.$apply();
          }, 500);
        });
      }, 1);
    } else {
      $scope.unmute(characteristic);
    }
  };

  $scope.unmute = function(characteristic) {
    var index = $scope.muted.indexOf(characteristic);
    if (index > -1) {
      $scope.muted[index].muted = false;
      characteristic.muteOpen = false;
      setTimeout(function() {
        if (characteristic.available) {
          characteristic.open = true;
        }
        $scope.muted.splice(index, 1);
        $scope.$apply();
      }, 1);
    }
  };
}]);
