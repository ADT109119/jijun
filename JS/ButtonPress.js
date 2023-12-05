// JavaScript Document


//數字鍵
document.querySelectorAll(".NumberButton").forEach(function(item){
	item.onclick = function(){
		NumberPadPress(this);
	}
})


function NumberPadPress(obj){
	let MoneyDisplay = document.querySelector(".MoneyDisplay");
	if(MoneyDisplay.innerHTML.length > 12)
		return 0;
	
	MoneyDisplay.innerHTML = MoneyDisplay.innerHTML + obj.innerHTML;
	
	if((MoneyDisplay.innerHTML[0] == "0" && MoneyDisplay.innerHTML.indexOf(".") == -1) || MoneyDisplay.innerHTML.split(".").length > 2)
		MoneyDisplay.innerHTML = parseFloat(MoneyDisplay.innerHTML);
	
}

//記帳收入or支出選擇
function InOutSwitch(obj){
	document.querySelector(".ButtonA.out").classList.remove("active")
	document.querySelector(".ButtonA.in").classList.remove("active")
	
	document.querySelector(".Selections.out").classList.remove("active")
	document.querySelector(".Selections.in").classList.remove("active")
	
	document.querySelectorAll(".ClassesC").forEach(function(item){
		item.classList.remove("active");
		
	})
	
	SelectedClass = "";
	
	obj.classList.add("active")
	if(obj.classList.contains("in")){
		document.querySelector(".Selections.in").classList.add("active")
		InOrOut = "InType"
	}
	else{
		document.querySelector(".Selections.out").classList.add("active")
		InOrOut = "OutType";
	}

}

//查帳收入or支出選擇
var ChaJunIn_Or_Out = "OutType"
function ChaJunInOutSwitch(obj){
	ClearChaJunItem_And_ResetChaJunTempMoney();
	document.querySelector(".ButtonA.ChaJunOut").classList.remove("active")
	document.querySelector(".ButtonA.ChaJunIn").classList.remove("active")
	obj.classList.add("active")
	
	//let OutClasses = ["飲食","日常","交通","娛樂","醫療","教育","其他"];
	//let InClasses = ["薪水","獎金","零用錢","兼職","投資","利息","其他"];
	
	if(obj.classList.contains("ChaJunOut")){
		ChaJunIn_Or_Out = "OutType";
		document.querySelectorAll(".ChaJunNoClassSelector").forEach(function(Item, i){
			Item.innerHTML = InOutClasses[ChaJunIn_Or_Out][0][i];
		})
	}else{
		ChaJunIn_Or_Out = "InType";
		document.querySelectorAll(".ChaJunNoClassSelector").forEach(function(Item, i){
			Item.innerHTML = InOutClasses[ChaJunIn_Or_Out][0][i];
		})
	}
	
}

//收入支出類別選擇
document.querySelectorAll(".ClassesC").forEach(function(item){
	item.onclick = function(){
		document.querySelectorAll(".ClassesC").forEach(function(item){
			item.classList.remove("active");
		})
		
		this.classList.add("active");
		SelectedClass = this.className.replace(/ /ig, "").replace("ClassesC", "").replace("active", "");
	}
})
//收入支出類別選擇


function AC(){
	document.querySelector(".MoneyDisplay").innerHTML = "0";
}


//底部功能選擇器
document.querySelectorAll(".FunctionButton").forEach(function(item, i){
	item.onclick = function(){
		document.querySelectorAll(".FunctionButton").forEach(function(item){
			item.classList.remove("active");
		})
		
		document.querySelectorAll(".Container").forEach(function(item){
			item.classList.remove("active");
		})
		
		document.querySelector(".ShowSelectedFunction").style.setProperty("--i", i);
		document.querySelectorAll(".Container")[i].classList.add("active");
		this.classList.add("active");
		if(i == 2)
			ChaJunTransition()
	}
})

//查帳選單伸縮
document.querySelectorAll(".ChaJunNoClassSelector").forEach(function(Item){
	Item.onclick = function(){
		this.classList.toggle("active");
	}
})

//查帳日期快速選擇
document.querySelectorAll(".SetSearchDate").forEach(function(Item){
	Item.onclick = function(){
		switch(this.name){
			case "Today":
				document.querySelector(".ChaJunDate.Earlier").value = TodaysDate;
				document.querySelector(".ChaJunDate.Later").value = TodaysDate;
				return 0;
				
			case "Week":
				document.querySelector(".ChaJunDate.Earlier").value = DateParse(SundayDate);
				document.querySelector(".ChaJunDate.Later").value = TodaysDate;
				return 0;
				
			case "SevenDays":
				document.querySelector(".ChaJunDate.Earlier").value = DateParse(SevenDays);
				document.querySelector(".ChaJunDate.Later").value = TodaysDate;
				return 0;
				
			case "Month":
				let TempSplit = TodaysDate.split("-");
				let year = TempSplit[0];
				let month = TempSplit[1];
				let date = TempSplit[2];
				document.querySelector(".ChaJunDate.Earlier").value = year+"-"+month+"-"+"01";
				document.querySelector(".ChaJunDate.Later").value = TodaysDate;
				return 0;
				
			case "LastMonth":
				let TempSplit2 = TodaysDate.split("-");
				let year2 = TempSplit2[0];
				
				var newddd = new Date();
				let LastMonth = newddd.getMonth();
				let ThisMonth = newddd.getMonth()+1;
				
				if(LastMonth < 10 && LastMonth != 0)
					LastMonth = "0" + LastMonth;
				
				if(ThisMonth < 10)
					ThisMonth = "0" + ThisMonth;
				
				let date2 = new Date(year2+"-"+ThisMonth+"-"+"01");
				date2.setDate(date2.getDate() - 1);
				
				if(LastMonth == 0){
					LastMonth = 12;
					year2 -= 1;
				}
				
				document.querySelector(".ChaJunDate.Earlier").value = year2+"-"+LastMonth+"-"+"01";
				document.querySelector(".ChaJunDate.Later").value = DateParse(date2);
				return 0;
				
		}

		ChaJunTransition()
	}
})

//生成打勾圖示
function DisplaySaveSuccess(){
	
	let div = document.createElement("div");
	div.className = "SaveSuccessWindow"
	
	div.innerHTML = '<svg class="svgSaveSuccess"><circle class="circle" fill="none" stroke="#68E534" stroke-width="20" cx="200" cy="200" r="190" stroke-linecap="round" transform="rotate(-90,200,200)" /><polyline class="tick" fill="none" stroke="#68E534" stroke-width="24" points="88,214 173,284 304,138" stroke-linecap="round" stroke-linejoin="round" /></svg><div class="Success">Success</div>'
	
	document.body.append(div);
	
	div.onload = tempA();
}

function tempA(){
	
	let temp = document.querySelector(".SaveSuccessWindow .circle").getBoundingClientRect().width +15;
	document.querySelector(".SaveSuccessWindow .svgSaveSuccess").style.width = temp;
	document.querySelector(".SaveSuccessWindow .svgSaveSuccess").style.height = temp;
	setTimeout(function(){
		document.querySelector(".SaveSuccessWindow").remove();
	}, 3000);
	
}


//主頁資料下載按鈕
document.querySelector(".DataDownloadAndInputButton.DownloadButton").onclick = function(){
	CreateAndDownloadAllTheData();
}

//主頁資料讀取按鈕
/*
document.querySelector(".DataDownloadAndInputButton.InputButton input").onChange = function(){
	InputOuterAllTheData(this.files);
}
*/

//主頁雲端儲存按鈕
document.querySelector(".DataDownloadAndInputButton.CloudStorageButton").onclick = function(){
	document.querySelectorAll(".Container").forEach(function(item){
		item.classList.remove("active");
	})
	document.querySelector(".Container.CloudStorageContainer").classList.add("active");
}





