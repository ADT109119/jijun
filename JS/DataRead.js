// JavaScript Document


function ReadMoney_HomePage(D1, D2, Target){
	let EarlierDay = new Date(D1);
	let LaterDay = new Date(D2);
	let TempMoney = 0;
	
	
	//AllTheData[]
	while(EarlierDay - LaterDay <= 0){
		let day = EarlierDay.getDate();

		if(day < 10)
			day = "0" +day;

		let month = EarlierDay.getMonth() + 1;

		if(month < 10)
			month = "0" +month;

		let year = EarlierDay.getFullYear();
		
		if(AllTheData[year][month][day] != undefined)
			for(let i = 0 ; i < InOutClasses["OutType"][1].length ; i++){
				if(AllTheData[year][month][day]["OutType"][InOutClasses["OutType"][1][i]]["money"] == undefined)
					continue;
				
				for(let j = 1 ; j <= AllTheData[year][month][day]["OutType"][InOutClasses["OutType"][1][i]]["money"].length ; j++){
					if(AllTheData[year][month][day]["OutType"][InOutClasses["OutType"][1][i]]["money"][j] != undefined){
						TempMoney += parseFloat(AllTheData[year][month][day]["OutType"][InOutClasses["OutType"][1][i]]["money"][j]);
						
						//console.log(AllTheData[year][month][day]["OutType"][InOutClasses["OutType"][1][i]]["money"][j]);
					}
					
				}
				//console.log("---");
			}
			
		
		if(day == 32)
			break;
		
		//console.log(TempMoney);
		//console.log((EarlierDay - LaterDay) /1000/60/60/24);
		EarlierDay.setDate(EarlierDay.getDate() + 1);
	}
	
	//EarlierDay.setDate(EarlierDay.getDate() + 1);
	document.querySelector(".MoneySpendDisplay."+Target).innerHTML = TempMoney;
}

function ChaJunTransition(){
	ChaJun(document.querySelector(".ChaJunDate.Earlier").value, document.querySelector(".ChaJunDate.Later").value, 0);
}

var ChaJunTempMoney = [0,0,0,0,0,0,0];

function ChaJun(Earlier, Later, n){
	
	if(n == 0)
		ClearChaJunItem_And_ResetChaJunTempMoney();
	/*
	let Earlier = document.querySelector(".ChaJunDate.Earlier").value;
	let Later = document.querySelector(".ChaJunDate.Later").value;
	*/
	
	let ChaJunTempDate = new Date(Earlier);
	let LaterDate = new Date(Later);
	let EarlierSplit = Earlier.split("-");
	
	let  ChaJunItemDisplay = document.querySelectorAll(".ChaJunItemDisplay");
	
	if((LaterDate - ChaJunTempDate) >= 0 && AllTheData[EarlierSplit[0]][EarlierSplit[1]][EarlierSplit[2]] != undefined){
		
		let Data = AllTheData[EarlierSplit[0]][EarlierSplit[1]][EarlierSplit[2]][ChaJunIn_Or_Out];
		
		for(let i = 0 ; i < InOutClasses[ChaJunIn_Or_Out][1].length ; i++){
			if(Data[InOutClasses[ChaJunIn_Or_Out][1][i]]["money"] == undefined)
				continue;
			
			for(let j = 1 ; j < Data[InOutClasses[ChaJunIn_Or_Out][1][i]]["money"].length ; j++){
				
				let ChaJunItem = document.createElement("div");
				ChaJunItem.className = "ChaJunItem";

				let ChaJunItemSectionDate = document.createElement("span");
				ChaJunItemSectionDate.classList.add("ChaJunItemSection");
				ChaJunItemSectionDate.classList.add("Date");
				ChaJunItemSectionDate.innerHTML = EarlierSplit[1] + "/" + EarlierSplit[2];
				//ChaJunItemSectionDate.innerHTML = EarlierSplit[0] + "/" + EarlierSplit[1] + "/" + EarlierSplit[2];

				let ChaJunItemSectionDescription = document.createElement("input");
				ChaJunItemSectionDescription.classList.add("ChaJunItemSection");
				ChaJunItemSectionDescription.classList.add("Description");
				ChaJunItemSectionDescription.value = Data[InOutClasses[ChaJunIn_Or_Out][1][i]]["description"][j];
				ChaJunItemSectionDescription.readOnly = true;
				
				let ChaJunItemSectionEdit = document.createElement("span");
				ChaJunItemSectionEdit.classList.add("ChaJunItemSection");
				ChaJunItemSectionEdit.classList.add("Edit");
				ChaJunItemSectionEdit.innerHTML = "Edit";
				ChaJunItemSectionEdit.dataset.date = Earlier;
				ChaJunItemSectionEdit.dataset.classes = InOutClasses[ChaJunIn_Or_Out][1][i];
				ChaJunItemSectionEdit.dataset.classesname = InOutClasses[ChaJunIn_Or_Out][0][i];
				ChaJunItemSectionEdit.dataset.i = j;

				let ChaJunItemSectionMoney = document.createElement("span");
				ChaJunItemSectionMoney.classList.add("ChaJunItemSection");
				ChaJunItemSectionMoney.classList.add("Money");
				ChaJunItemSectionMoney.innerHTML = "$" + Data[InOutClasses[ChaJunIn_Or_Out][1][i]]["money"][j];
				ChaJunTempMoney[i] += parseFloat(Data[InOutClasses[ChaJunIn_Or_Out][1][i]]["money"][j]);
				
				ChaJunItem.append(ChaJunItemSectionDate);
				ChaJunItem.append(ChaJunItemSectionDescription);
				ChaJunItem.append(ChaJunItemSectionEdit);
				ChaJunItem.append(ChaJunItemSectionMoney);
				
				ChaJunItemDisplay[i].append(ChaJunItem);
				
				
			}
			document.querySelectorAll(".ChaJunNoClassSelector")[i].dataset.totalmoney = "$" + ChaJunTempMoney[i];
			
		}
		
	}
	
	ChaJunTempDate.setDate(ChaJunTempDate.getDate() + 1);
	
	
	if((LaterDate - ChaJunTempDate) >= 0){
		ChaJun(DateParse(ChaJunTempDate), Later, n+1);
	}else{
		ActiveEditButton();
	}
	//console.log(LaterDate - ChaJunTempDate);
}


function ClearChaJunItem_And_ResetChaJunTempMoney(){
	ChaJunTempMoney = [0,0,0,0,0,0,0];
	document.querySelectorAll(".ChaJunItem").forEach(function(Item){
		Item.remove();
	})
	document.querySelectorAll(".ChaJunNoClassSelector").forEach(function(Item){
		Item.dataset.totalmoney = "$0";
	})
}









