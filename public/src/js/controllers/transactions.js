'use strict';

angular.module('insight.transactions').controller('transactionsController',
function($scope, $rootScope, $routeParams, $location, Global, Transaction, TransactionsByBlock, TransactionsByAddress) {
  $scope.global = Global;
  $scope.loading = false;
  $scope.loadedBy = null;

  var pageNum = 0;
  var pagesTotal = 1;
  var COIN = 100000000;

  // Prefixes that identify Spark / Lelantus / Sigma shielded addresses
  var SHIELDED_PREFIXES = [
    'Sparks', 'Sparkspend', 'Sparksmint', 'Sparkname', 'spark',
    'Lelantusjmint', 'Lelantusjsplit', 'Lelantusj',
    'Sigma', 'Zero'
  ];

  // Shielded scriptPubKey types
  var SHIELDED_TYPES = [
    'lelantusjmint', 'sparksmint', 'sparkname', 'spark',
    'lelantusjsplit', 'sigmamint'
  ];

  var _isShieldedAddr = function(addr) {
    if (!addr) return false;
    for (var i = 0; i < SHIELDED_PREFIXES.length; i++) {
      if (addr.startsWith(SHIELDED_PREFIXES[i])) return true;
    }
    return false;
  };

  var _isShieldedType = function(type) {
    if (!type) return false;
    return SHIELDED_TYPES.indexOf(type) !== -1;
  };

  var _aggregateItems = function(items) {
    if (!items) return [];

    var l = items.length;
    var ret = [];
    var tmp = {};
    var u = 0;

    for (var i = 0; i < l; i++) {

      var notAddr = false;
      var isSigma = false;

      // non standard input
      if (items[i].scriptSig && !items[i].addr) {
        items[i].addr = 'Unparsed address [' + u++ + ']';
        items[i].notAddr = true;
        notAddr = true;
      }

      // non standard output
      if (items[i].scriptPubKey && !items[i].scriptPubKey.addresses) {
        items[i].scriptPubKey.addresses = ['Unparsed address [' + u++ + ']'];
        items[i].notAddr = true;
        notAddr = true;
      }

      if (items[i].addr && (items[i].addr.startsWith('Sigma') || items[i].addr.startsWith('Zero'))) {
        items[i].isSigma = true;
        isSigma = true;
      }

      // multiple addr at output
      if (items[i].scriptPubKey && items[i].scriptPubKey.addresses.length > 1) {
        items[i].addr = items[i].scriptPubKey.addresses.join(',');
        // tag shielded flag on multi-addr outputs
        items[i].isShielded = _isShieldedAddr(items[i].addr) ||
                              _isShieldedType(items[i].scriptPubKey && items[i].scriptPubKey.type);
        ret.push(items[i]);
        continue;
      }

      var addr = items[i].addr || (items[i].scriptPubKey && items[i].scriptPubKey.addresses[0]);

      if (!tmp[addr]) {
        tmp[addr] = {};
        tmp[addr].valueSat = 0;
        tmp[addr].count = 0;
        tmp[addr].addr = addr;
        tmp[addr].items = [];
        // Determine shielded status once per aggregated address bucket
        tmp[addr].isShielded = _isShieldedAddr(addr) ||
                               _isShieldedType(items[i].scriptPubKey && items[i].scriptPubKey.type);
      }

      tmp[addr].isSpent = items[i].spentTxId;
      // For shielded outputs: strip spentTxId so it can never leak forward links
      if (tmp[addr].isShielded) {
        delete items[i].spentTxId;
        delete items[i].spentIndex;
        delete items[i].spentHeight;
      }

      tmp[addr].doubleSpentTxID   = tmp[addr].doubleSpentTxID   || items[i].doubleSpentTxID;
      tmp[addr].doubleSpentIndex  = tmp[addr].doubleSpentIndex  || items[i].doubleSpentIndex;
      tmp[addr].dbError           = tmp[addr].dbError           || items[i].dbError;
      tmp[addr].valueSat         += Math.round(items[i].value * COIN);
      tmp[addr].items.push(items[i]);
      tmp[addr].notAddr           = notAddr;
      tmp[addr].isSigma           = isSigma;

      if (items[i].unconfirmedInput)
        tmp[addr].unconfirmedInput = true;

      tmp[addr].count++;
    }

    angular.forEach(tmp, function(v) {
      v.value = v.value || parseInt(v.valueSat) / COIN;
      ret.push(v);
    });
    return ret;
  };

  var _processTX = function(tx) {
    tx.vinSimple  = _aggregateItems(tx.vin);
    tx.voutSimple = _aggregateItems(tx.vout);

    // Extra pass: strip spentTxId from raw vout entries for shielded outputs
    // so the full expanded view cannot use them either
    if (tx.vout) {
      tx.vout.forEach(function(vout) {
        var type = vout.scriptPubKey && vout.scriptPubKey.type;
        var addr = vout.scriptPubKey && vout.scriptPubKey.addresses && vout.scriptPubKey.addresses[0];
        if (_isShieldedType(type) || _isShieldedAddr(addr)) {
          delete vout.spentTxId;
          delete vout.spentIndex;
          delete vout.spentHeight;
        }
      });
    }
  };

  var _paginate = function(data) {
    $scope.loading = false;
    pagesTotal = data.pagesTotal;
    pageNum += 1;
    data.txs.forEach(function(tx) {
      _processTX(tx);
      $scope.txs.push(tx);
    });
  };

  var _byBlock = function() {
    TransactionsByBlock.get({
      block: $routeParams.blockHash,
      pageNum: pageNum
    }, function(data) {
      _paginate(data);
    });
  };

  var _byAddress = function() {
    TransactionsByAddress.get({
      address: $routeParams.addrStr,
      pageNum: pageNum
    }, function(data) {
      _paginate(data);
    });
  };

  var _findTx = function(txid) {
    Transaction.get({
      txId: txid
    }, function(tx) {
      $rootScope.titleDetail = tx.txid.substring(0, 7) + '...';
      $rootScope.flashMessage = null;
      $scope.tx = tx;
      _processTX(tx);
      $scope.txs.unshift(tx);
    }, function(e) {
      if (e.status === 400) {
        $rootScope.flashMessage = 'Invalid Transaction ID: ' + $routeParams.txId;
      } else if (e.status === 503) {
        $rootScope.flashMessage = 'Backend Error. ' + e.data;
      } else {
        $rootScope.flashMessage = 'Transaction Not Found';
      }
      $location.path('/');
    });
  };

  $scope.findThis = function() {
    _findTx($routeParams.txId);
  };

  // Initial load
  $scope.load = function(from) {
    $scope.loadedBy = from;
    $scope.loadMore();
  };

  // Load more transactions for pagination
  $scope.loadMore = function() {
    if (pageNum < pagesTotal && !$scope.loading) {
      $scope.loading = true;
      if ($scope.loadedBy === 'address') {
        _byAddress();
      } else {
        _byBlock();
      }
    }
  };

  // Highlighted txout — kept intact for T-address traversal
  // Shielded inputs/outputs will still render as "Hidden" labels via isShielded flag
  if ($routeParams.v_type == '>' || $routeParams.v_type == '<') {
    $scope.from_vin  = $routeParams.v_type == '<' ? true : false;
    $scope.from_vout = $routeParams.v_type == '>' ? true : false;
    $scope.v_index   = parseInt($routeParams.v_index);
    $scope.itemsExpanded = true;
    $scope.extraPayloadExpanded = false;
  }

  // Init without txs
  $scope.txs = [];

  $scope.$on('tx', function(event, txid) {
    _findTx(txid);
  });

});

angular.module('insight.transactions').controller('SendRawTransactionController',
  function($scope, $http) {
    $scope.transaction = '';
    $scope.status = 'ready'; // ready|loading|sent|error
    $scope.txid = '';
    $scope.error = null;

    $scope.formValid = function() {
      return !!$scope.transaction;
    };

    $scope.send = function() {
      var postData = { rawtx: $scope.transaction };
      $scope.status = 'loading';
      $http.post(window.apiPrefix + '/tx/send', postData)
        .success(function(data) {
          if (typeof(data.txid) != 'string') {
            $scope.status = 'error';
            $scope.error = 'The transaction was sent but no transaction id was got back';
            return;
          }
          $scope.status = 'sent';
          $scope.txid = data.txid;
        })
        .error(function(data) {
          $scope.status = 'error';
          $scope.error = data || 'No error message given (connection error?)';
        });
    };
  }
);
